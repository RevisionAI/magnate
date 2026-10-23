#!/usr/bin/env python3
"""Magnate audio mastering pipeline (audio-plan section 2.4).

Reads tools/audio/sources.json (plus the VO sets it names, e.g. assets-src/vo/manifest.json), masters
every kept asset and writes

  web/public/audio/<dir>/<name>.ogg   Ogg Opus 48 kHz (primary)
  web/public/audio/<dir>/<name>.m4a   AAC-LC fallback (aac_at on macOS, else ffmpeg aac)
  web/public/audio/manifest.json      ids, files per codec, measured loudness, loop points, grid, provenance
  web/src/audio/assets/probe.generated.ts   base64 of tools/audio/probe.ogg (runtime codec probe)

Chains (all at 48 kHz float):
  music : [trim] -> highpass 25 Hz -> bake loop seam -> gain to -20 LUFS-I -> 4x-oversampled limiter
  vo    : [edge trim] -> highpass 70 Hz -> compressor 2.5:1 @ -24 dB -> gain to -18 LUFS-I (dual-mono) -> limiter
  sfx   : trim head <= 5 ms / tail at -60 dB -> highpass 30 Hz -> [eq] -> gain to class M-max -> limiter

Gains are computed with a numpy BS.1770-4 meter, then the delivered .ogg is decoded and re-measured
with ffmpeg's ebur128 filter (the official number); if it misses the target by more than 0.3 LU or the
true peak is over the class ceiling the asset is re-rendered with a corrected gain/ceiling (max 4 passes).

Idempotent: each asset carries a build key (source md5 + settings + pipeline version); unchanged assets
whose outputs are intact are reused byte-for-byte. Files under web/public/audio that are not produced by
this run (e.g. the legacy MP3 copies) are deleted. Encodes are bit-exact (no random Ogg serials).

Usage:
  python3 tools/audio/master.py              # build (incremental)
  python3 tools/audio/master.py --force      # rebuild everything
  python3 tools/audio/master.py --only music.title,upgrade
  python3 tools/audio/master.py --check      # verify the delivered files only (see verify_loudness.py)
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import audiolib as A  # noqa: E402

ROOT = HERE.parents[1]
OUT = ROOT / "web" / "public" / "audio"
MANIFEST = OUT / "manifest.json"
PROBE_TS = ROOT / "web" / "src" / "audio" / "assets" / "probe.generated.ts"
PIPELINE_VERSION = 3
MANAGED_EXT = {".ogg", ".m4a", ".mp3", ".wav", ".webm", ".flac"}
TOL_LU = 0.3


def ffmpeg_version() -> str:
    out = subprocess.run([A.FFMPEG, "-hide_banner", "-version"], capture_output=True, text=True).stdout
    first = out.splitlines()[0] if out else "unknown"
    return first.split(" Copyright")[0]


def m4a_encoder() -> str:
    return "aac_at" if A.has_encoder("aac_at") else "aac"


# ----------------------------------------------------------------------------- stages


def limiter_chain(ceiling_db: float) -> str:
    rs = "aresample={sr}:resampler=soxr:precision=28"
    return ",".join(
        [
            rs.format(sr=192000),
            f"alimiter=limit={ceiling_db:.2f}dB:attack=3:release=40:level=false:asc=1:latency=true",
            rs.format(sr=A.SR),
        ]
    )


def trim_sfx(audio: np.ndarray) -> np.ndarray:
    """Head silence to <= 5 ms (with a 2 ms fade-in when trimmed), tail cut at -60 dB + 20 ms fade-out."""
    thr = 10 ** (-60 / 20)
    loud = np.nonzero(np.max(np.abs(audio), axis=1) > thr)[0]
    if loud.size == 0:
        raise A.ToolError("asset is silent")
    keep_head = int(0.005 * A.SR)
    start = max(0, loud[0] - keep_head)
    end = min(audio.shape[0], loud[-1] + 1 + int(0.02 * A.SR))
    out = audio[start:end]
    if start > 0:
        out = A.fade(out, A.SR, fade_in=0.002)
    return A.fade(out, A.SR, fade_out=0.02)


def trim_vo(audio: np.ndarray, cfg: dict) -> np.ndarray:
    """Voice edges: keep `headMs` before the first and `tailMs` after the last 5 ms window whose peak
    exceeds `thresholdDb`, then a short raised edge (5 ms in, 20 ms out). The a2 masters carry 120 ms
    of padding either side; trimming the head cuts the delay between a trigger and the first word."""
    thr = 10 ** (float(cfg.get("thresholdDb", -50.0)) / 20)
    win = int(0.005 * A.SR)
    env = np.max(np.abs(audio), axis=1)
    n = env.shape[0] // win
    if n == 0:
        raise A.ToolError("voice line is shorter than 5 ms")
    blocks = env[: n * win].reshape(n, win).max(axis=1)
    loud = np.nonzero(blocks > thr)[0]
    if loud.size == 0:
        raise A.ToolError("voice line is silent")
    start = max(0, loud[0] * win - int(float(cfg.get("headMs", 30)) / 1000 * A.SR))
    end = min(audio.shape[0], (loud[-1] + 1) * win + int(float(cfg.get("tailMs", 120)) / 1000 * A.SR))
    return A.fade(audio[start:end], A.SR, fade_in=0.005, fade_out=0.02)


def pre_process(asset: dict, cls: dict, audio: np.ndarray) -> tuple[np.ndarray, float]:
    """Everything before the gain stage. Returns (audio, head_trim_seconds)."""
    trim = float(asset.get("trimHeadSec", 0.0))
    if trim > 0:
        audio = audio[int(round(trim * A.SR)) :]
    if asset["kind"] == "sfx":
        audio = trim_sfx(audio)  # one-shots carry no loop points or grid, so the head trim needs no bookkeeping
    elif asset["kind"] == "vo" and asset.get("trimVo"):
        audio = trim_vo(audio, asset["trimVo"])
    elif asset.get("trimTailDb") is not None:
        thr = 10 ** (float(asset["trimTailDb"]) / 20)
        loud = np.nonzero(np.max(np.abs(audio), axis=1) > thr)[0]
        if loud.size:
            audio = A.fade(audio[: loud[-1] + 1 + int(0.03 * A.SR)], A.SR, fade_out=0.03)
    chain = [f"highpass=f={cls['highpass']}:poles=2"]
    if asset["kind"] == "vo":
        chain.append("acompressor=threshold=-24dB:ratio=2.5:attack=5:release=80:knee=4:makeup=1")
    if asset.get("eq"):
        chain.append(asset["eq"])
    audio = A.ffmpeg_filter(audio, ",".join(chain))
    return audio, trim


def metric_of(cls: dict, lo: dict) -> float:
    return lo["lufsI"] if cls["metric"] == "I" else lo["mMax"]


def encode(master_wav: Path, out_base: Path, cls: dict, channels: int) -> dict[str, Path]:
    out_base.parent.mkdir(parents=True, exist_ok=True)
    ogg, m4a = out_base.with_suffix(out_base.suffix + ".ogg"), out_base.with_suffix(out_base.suffix + ".m4a")
    common = ["-fflags", "+bitexact", "-flags:a", "+bitexact", "-map_metadata", "-1", "-ac", str(channels)]
    A.run(
        [A.FFMPEG, "-v", "error", "-nostdin", "-y", "-i", str(master_wav), *common,
         "-c:a", "libopus", "-b:a", cls["opus"], "-vbr", "constrained", "-application", "audio",
         "-frame_duration", "20", str(ogg)]
    )
    A.run(
        [A.FFMPEG, "-v", "error", "-nostdin", "-y", "-i", str(master_wav), *common,
         "-c:a", m4a_encoder(), "-b:a", cls["m4a"], "-movflags", "+faststart", str(m4a)]
    )
    return {"ogg": ogg, "m4a": m4a}


# ----------------------------------------------------------------------------- one asset


def build_asset(asset: dict, cls: dict, tmp: Path) -> dict:
    src = ROOT / asset["src"]
    channels_cfg = asset.get("channels", 2)
    decoded = A.decode(src, 2 if channels_cfg == "auto" else int(channels_cfg))
    width = A.stereo_width_db(decoded) if decoded.shape[1] == 2 else -math.inf
    if channels_cfg == "auto":
        if width < -25.0:
            decoded = decoded.mean(axis=1, keepdims=True).astype(np.float32)
    channels = decoded.shape[1]
    audio, trim = pre_process(asset, cls, decoded)

    loop_info = None
    if asset.get("loop"):
        lp = asset["loop"]
        s = int(round((lp["startSec"] - trim) * A.SR))
        e = int(round((lp["endSec"] - trim) * A.SR))
        xf = int(round(lp["seamSec"] * A.SR))
        audio = A.bake_seam(audio, s, e, xf)
        loop_info = {"startSample": s, "endSample": e, "seamSec": lp["seamSec"]}

    dual = bool(cls["dualMono"])
    pre = A.measure(audio, dual_mono=dual)
    gain = cls["target"] - metric_of(cls, pre.as_dict())
    ceiling = cls["limiter"]
    files: dict[str, Path] = {}
    official: dict = {}
    for attempt in range(4):
        mastered = A.ffmpeg_filter(audio * (10 ** (gain / 20)), limiter_chain(ceiling))
        if mastered.shape[0] != audio.shape[0]:
            raise A.ToolError(f"{asset['id']}: limiter changed length {audio.shape[0]} -> {mastered.shape[0]}")
        wav = tmp / f"{asset['out'].replace('/', '_')}.wav"
        A.write_wav(wav, mastered)
        files = encode(wav, OUT / asset["out"], cls, channels)
        official = A.ffmpeg_ebur128(files["ogg"], dual_mono=dual and channels == 1)
        miss = cls["target"] - metric_of(cls, official)
        over = official["truePeak"] - cls["tpMax"]
        if abs(miss) <= TOL_LU and over <= 0:
            break
        gain += miss
        if over > 0:
            ceiling -= over + 0.2
    delivered = A.decode(files["ogg"], channels)
    if delivered.shape[0] != audio.shape[0]:
        raise A.ToolError(f"{asset['id']}: ogg decode length {delivered.shape[0]} != master {audio.shape[0]}")
    m4a_meas = A.ffmpeg_ebur128(files["m4a"], dual_mono=dual and channels == 1)

    entry: dict = {
        "id": asset["id"],
        "kind": asset["kind"],
        "class": asset["class"],
        "channels": channels,
        "lengthSamples": int(audio.shape[0]),
        "durationSec": round(audio.shape[0] / A.SR, 6),
        "files": {
            "ogg": A.rel(files["ogg"], OUT),
            "m4a": A.rel(files["m4a"], OUT),
            "oggBytes": files["ogg"].stat().st_size,
            "m4aBytes": files["m4a"].stat().st_size,
        },
        "loudness": {
            "metric": "LUFS-I" if cls["metric"] == "I" else "LUFS-M max",
            "target": cls["target"],
            "tpMax": cls["tpMax"],
            "dualMono": dual and channels == 1,
            "lufsI": _r(official["lufsI"]),
            "mMax": _r(official["mMax"]),
            "truePeak": _r(official["truePeak"]),
            "m4aLufsI": _r(m4a_meas["lufsI"]),
            "m4aTruePeak": _r(m4a_meas["truePeak"]),
            "gainDb": round(gain, 2),
            "limiterDb": round(ceiling, 2),
            "source": pre_source(src, channels, dual),
        },
        "preload": asset.get("preload", "lazy"),
    }
    if asset.get("variant"):
        entry["variant"] = asset["variant"]
    if loop_info:
        s, e = loop_info["startSample"], loop_info["endSample"]
        entry["loop"] = {
            "startSec": round(s / A.SR, 6),
            "endSec": round(e / A.SR, 6),
            "startSample": s,
            "endSample": e,
            "seamSec": loop_info["seamSec"],
            "qa": A.seam_qa(delivered, s, e),
        }
        entry["tail"] = {"startSec": round(e / A.SR, 6), "endSec": round(audio.shape[0] / A.SR, 6)}
    if asset.get("grid"):
        grid = dict(asset["grid"])
        grid["firstBeatSec"] = round(max(0.0, grid["firstBeatSec"] - trim), 4)
        entry["grid"] = grid
    if asset["kind"] == "sfx":
        entry["headSilenceMs"] = round(A.head_silence(delivered) * 1000, 1)
    if asset.get("text"):
        entry["text"] = asset["text"]
        entry["voice"] = asset.get("voice", "advisor")
    if asset.get("line"):
        # one VO line (audio-plan section 5): the subtitle is `text`; old names resolve through
        # legacyAlias / aliases (also in the manifest's top-level `vo` maps)
        entry["line"] = asset["line"]
        entry["role"] = asset.get("voice", "advisor")
        entry["priority"] = asset.get("priority")
        entry["legacyAlias"] = asset.get("legacyAlias")
        entry["aliases"] = asset.get("aliases", [])
        if asset.get("tts"):
            entry["tts"] = asset["tts"]
        if asset.get("trimVo"):
            entry["trimmedFromSec"] = round(decoded.shape[0] / A.SR, 6)
    if trim:
        entry["trimHeadSec"] = trim
    entry["provenance"] = {
        "source": asset["src"],
        "sourceMd5": A.md5_file(src),
        "sourceWidthDb": None if not math.isfinite(width) else round(width, 1),
        "notes": asset.get("notes", ""),
    }
    if asset.get("voProvenance"):
        entry["provenance"].update(asset["voProvenance"])
    return entry


def pre_source(src: Path, channels: int, dual: bool) -> dict:
    lo = A.measure(A.decode(src, channels), dual_mono=dual and channels == 1)
    return {"lufsI": _r(lo.integrated), "mMax": _r(lo.momentary_max), "truePeak": _r(lo.true_peak)}


def _r(v: float):
    return None if v is None or not math.isfinite(v) else round(float(v), 2)


# ----------------------------------------------------------------------------- probe


def build_probe() -> str:
    probe = HERE / "probe.ogg"
    A.run(
        [A.FFMPEG, "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "0.02",
         "-fflags", "+bitexact", "-flags:a", "+bitexact", "-map_metadata", "-1",
         "-c:a", "libopus", "-b:a", "16k", str(probe)]
    )
    b64 = base64.b64encode(probe.read_bytes()).decode()
    PROBE_TS.parent.mkdir(parents=True, exist_ok=True)
    PROBE_TS.write_text(
        "// GENERATED by tools/audio/master.py — do not edit.\n"
        "// 20 ms of silence as Ogg Opus (tools/audio/probe.ogg). Decoding it with decodeAudioData is the\n"
        "// codec probe of audio-plan section 2.2 (never canPlayType).\n"
        f"export const PROBE_OGG_BASE64 =\n  '{b64}';\n"
    )
    return b64


# ----------------------------------------------------------------------------- VO sets


def expand_vo_sets(reg: dict) -> dict | None:
    """Append one `vo` asset per voiced line of every VO set in sources.json (`voSets`), e.g. the a2
    batch in assets-src/vo/manifest.json, and return the manifest's top-level `vo` section (counts,
    held lines, legacy and alias maps resolved to asset ids). Held lines (`file: null`) are listed,
    not mastered: the runtime shows their subtitle only."""
    sets = reg.get("voSets", [])
    if not sets:
        return None
    meta: dict = {"sets": [], "lines": 0, "held": [], "legacyMap": {}, "aliasMap": {}}
    known = {a["id"] for a in reg["assets"]}
    for vs in sets:
        src_manifest = ROOT / vs["manifest"]
        vm = json.loads(src_manifest.read_text())
        src_dir = src_manifest.parent
        prefix = vs.get("idPrefix", "vo.")
        preload = vs.get("preload", {})
        roles = vm.get("roles", {})
        n = 0
        for line in vm["lines"]:
            if not line.get("file"):
                meta["held"].append({"line": line["id"], "role": line["role"], "text": line["text"], "status": line.get("status", "held")})
                continue
            aid = prefix + line["id"]
            if aid in known:
                raise A.ToolError(f"duplicate asset id {aid} (VO set {vs['manifest']})")
            known.add(aid)
            asset = {
                "id": aid,
                "kind": "vo",
                "class": vs.get("class", "vo"),
                "src": A.rel(src_dir / line["file"], ROOT),
                "out": f"{vs.get('outDir', 'vo')}/{line['id']}",
                "channels": 1,
                "text": line["text"],
                "voice": line["role"],
                "line": line["id"],
                "priority": line.get("priority"),
                "legacyAlias": line.get("legacyAlias"),
                "aliases": line.get("aliases", []),
                "preload": preload.get(line["id"], "lazy"),
                "voProvenance": {
                    "provider": line.get("provider"),
                    "model": line.get("model"),
                    "voice": line.get("voice"),
                    "set": vs["manifest"],
                    "fallback": (roles.get(line["role"]) or {}).get("fallback", {}).get("reason"),
                },
            }
            if line.get("tts"):
                asset["tts"] = line["tts"]
            if vs.get("trim"):
                asset["trimVo"] = vs["trim"]
            reg["assets"].append(asset)
            n += 1
        meta["lines"] += n
        meta["sets"].append({"manifest": vs["manifest"], "lines": n, "roles": sorted({l["role"] for l in vm["lines"]})})
        to_asset = lambda f: prefix + Path(f).stem  # noqa: E731  "advisor/adv.onboard.welcome.wav" -> "vo.adv.onboard.welcome"
        for old, f in sorted(vm.get("legacyMap", {}).items()):
            meta["legacyMap"][old] = to_asset(f)
        for old, line_id in sorted(vm.get("aliasMap", {}).items()):
            meta["aliasMap"][old] = prefix + line_id
    return meta


# ----------------------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="rebuild every asset")
    ap.add_argument("--only", default="", help="comma-separated ids to (re)build; others are reused")
    ap.add_argument("--check", action="store_true", help="only run verify_loudness.py")
    args = ap.parse_args()

    if args.check:
        import verify_loudness

        return verify_loudness.main([])

    reg = json.loads((HERE / "sources.json").read_text())
    classes = reg["classes"]
    vo_meta = expand_vo_sets(reg)
    old = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    old_assets = {a["key"]: a for a in old.get("assets", []) if "key" in a}
    only = {x.strip() for x in args.only.split(",") if x.strip()}
    ffv = ffmpeg_version()

    entries = []
    with A.tmpdir() as tdir:
        tmp = Path(tdir)
        for asset in reg["assets"]:
            cls = classes[asset["class"]]
            key = A.sha1_json(
                {
                    "v": PIPELINE_VERSION,
                    "asset": asset,
                    "class": cls,
                    "srcMd5": A.md5_file(ROOT / asset["src"]),
                    "ffmpeg": ffv,
                    "m4a": m4a_encoder(),
                }
            )
            prev = old_assets.get(key)
            wanted = args.force or (only and asset["id"] in only)
            if prev and not wanted and _outputs_intact(prev):
                entries.append(prev)
                print(f"  = {asset['id']:<32} (unchanged)")
                continue
            entry = build_asset(asset, cls, tmp)
            entry["key"] = key
            entries.append(entry)
            lo = entry["loudness"]
            got = lo["lufsI"] if cls["metric"] == "I" else lo["mMax"]
            print(
                f"  + {asset['id']:<32} {lo['metric']:<10} {got:>6} (target {cls['target']}) "
                f"TP {lo['truePeak']:>5} dBTP  gain {lo['gainDb']:+.2f} dB  "
                f"{entry['files']['oggBytes'] / 1024:.0f} KB ogg / {entry['files']['m4aBytes'] / 1024:.0f} KB m4a"
            )

    probe_b64 = build_probe()
    manifest = {
        "$comment": "GENERATED by tools/audio/master.py from tools/audio/sources.json — do not edit by hand.",
        "version": 1,
        "pipelineVersion": PIPELINE_VERSION,
        "sampleRate": A.SR,
        "basePath": "audio/",
        "formats": ["ogg", "m4a"],
        "encoder": {"ffmpeg": ffv, "opus": "libopus constrained VBR, -application audio", "m4a": m4a_encoder()},
        "probeOggBase64Length": len(probe_b64),
        "classes": classes,
        "assets": sorted(entries, key=lambda e: (e["kind"], e["id"], e.get("variant", ""))),
        "retired": reg.get("retired", []),
        "provenance": reg.get("provenance", {}),
    }
    if vo_meta:
        manifest["vo"] = vo_meta
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    removed = _clean(manifest)
    for r in removed:
        print(f"  - removed {r}")
    print(f"manifest: {A.rel(MANIFEST, ROOT)} ({len(entries)} assets)")

    import verify_loudness

    return verify_loudness.main([])


def _outputs_intact(entry: dict) -> bool:
    f = entry.get("files", {})
    for fmt in ("ogg", "m4a"):
        p = OUT / f.get(fmt, "")
        if not f.get(fmt) or not p.exists() or p.stat().st_size != f.get(f"{fmt}Bytes"):
            return False
    return True


def _clean(manifest: dict) -> list[str]:
    keep = set()
    for e in manifest["assets"]:
        keep.add((OUT / e["files"]["ogg"]).resolve())
        keep.add((OUT / e["files"]["m4a"]).resolve())
    removed = []
    for p in sorted(OUT.rglob("*")):
        if p.is_file() and p.suffix.lower() in MANAGED_EXT and p.resolve() not in keep:
            p.unlink()
            removed.append(A.rel(p, ROOT))
    for d in sorted((p for p in OUT.rglob("*") if p.is_dir()), key=lambda p: -len(p.parts)):
        if not any(d.iterdir()):
            d.rmdir()
    return removed


if __name__ == "__main__":
    sys.exit(main())
