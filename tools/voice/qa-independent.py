#!/usr/bin/env python3
"""Independent QA of the VO masters. It re-measures every file from scratch and does not trust generate.mjs or the
.gen.json numbers (it only reads gen.json for provider/model/voice provenance, check 6).

Usage (from the repo root):
    tools/voice/.venv/bin/python tools/voice/qa-independent.py [--out assets-src/vo] [--json tools/voice/reports/qa-independent.json]
                                                             [--only id1,id2] [--no-stt]

Checks, per voiced line (the spec is the QA brief of the a2-voice workstream):
  1. coverage: every non-held id in lines.json has exactly one manifest entry and one file on disk; no orphan files
  2. decode (ffprobe): mono, 44.1-48 kHz, duration 1.2-8 s (informational below 1.2 s for scripted 2-word lines)
  3. pace 130-185 (advisor target 150-165). Two measures over the voiced span: raw wpm, and a word-length-neutral
     "wpm-eq" = CMUdict syllables/s x 60 / the role's mean syllables per word (computed here, not espeak).
     The pass/fail gate is wpm-eq; raw wpm outside 130-185 is listed as informational.
  4. true peak <= -0.5 dBTP (ffmpeg ebur128 peak=true); leading/trailing silence <= 300 ms and no internal silence
     > 700 ms (ffmpeg silencedetect at -45 dBFS)
  5. integrated LUFS spread per role <= 4 LU (ffmpeg ebur128)
  6. one provider + model + voice per role (gen.json)
  7. transcript: faster-whisper base.en with Silero VAD on (the generator transcribes without VAD and drops
     hallucinated tails heuristically, so this is a different path), WER > 15 % fails, "magnate" heard as "magnet" fails
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FFMPEG = os.environ.get("FFMPEG", "/usr/local/bin/ffmpeg" if os.path.exists("/usr/local/bin/ffmpeg") else "ffmpeg")
FFPROBE = os.environ.get("FFPROBE", "/usr/local/bin/ffprobe" if os.path.exists("/usr/local/bin/ffprobe") else "ffprobe")

PACE = {"advisor": (150, 165), "anchor": (140, 170)}  # targets; the gate is 130-185 for both
GATE = (130, 185)

# ---------------- text ----------------
ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def num_words(n):
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else " " + ONES[n % 10])
    if n < 1000:
        return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + num_words(n % 100))
    for div, name in ((10**9, "billion"), (10**6, "million"), (1000, "thousand")):
        if n >= div:
            return num_words(n // div) + " " + name + ("" if n % div == 0 else " " + num_words(n % div))
    return str(n)


SPELLING = {"recognize": "recognise", "licence": "license", "kickstart": "kick start", "okay": "ok"}
# sound-alike pairs a listener cannot separate either; merged so they don't count as errors (see also "arrival" below)
HOMOPHONES = {"cache": "cash", "lone": "loan", "whole": "hole"}


def normalise(s):
    s = s.lower()
    s = s.replace("r&d", "r and d").replace("&", " and ")
    s = re.sub(r"\$(\d+)\s*(million|billion|thousand)", lambda m: f"{m.group(1)} {m.group(2)} dollars", s)
    s = re.sub(r"\$(\d+)", lambda m: f"{m.group(1)} dollars", s)
    s = re.sub(r"(\d+)\s*%", lambda m: f"{m.group(1)} percent", s)
    s = re.sub(r"\b(\d{1,3}(?:,\d{3})+|\d+)\b", lambda m: num_words(int(m.group(1).replace(",", ""))), s)
    s = re.sub(r"\b([a-z])\.(?=[a-z]\.)", r"\1", s)  # I.P.O. -> ipo
    s = s.replace("i.p.o.", "ipo").replace("c.f.o.", "cfo")
    s = re.sub(r"\bi p o\b", "ipo", s)
    s = re.sub(r"[-\u2010-\u2015/]", " ", s)
    s = re.sub(r"[^a-z0-9' ]", " ", s)
    s = s.replace("'", "")
    # "a rival" and "arrival" are the same phonemes (/@'raIv@l/) in connected speech; context, not sound, separates
    # them, so Whisper's choice between them says nothing about the read. (The script never contains "arrival".)
    s = re.sub(r"\barrival\b", "a rival", s)
    words = []
    for w in s.split():
        w = SPELLING.get(w, w)
        w = HOMOPHONES.get(w, w)
        words.extend(w.split())
    out = " ".join(words)
    out = re.sub(r"\ba hundred\b", "one hundred", out)
    out = re.sub(r"\ba billion\b", "one billion", out)
    out = re.sub(r"\ba million\b", "one million", out)
    return out.split()


def wer(ref, hyp):
    r, h = ref, hyp
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev = cur
    return d[len(h)] / max(1, len(r))


_CMU = None


def syllables(word):
    """CMU Pronouncing Dictionary vowel count (independent of the generator's espeak-ng count); heuristic if OOV."""
    global _CMU
    if _CMU is None:
        try:
            import cmudict  # pip install cmudict (into tools/voice/.venv)
            _CMU = cmudict.dict()
        except ImportError:
            _CMU = {}
    w = re.sub(r"[^a-z]", "", word.lower())
    prons = _CMU.get(w) or _CMU.get(word.lower())
    if prons:
        return sum(1 for ph in prons[0] if ph[-1].isdigit())
    if len(w) in (1, 2, 3) and w in ("r", "d", "p", "o", "i", "ipo"):
        return {"ipo": 3}.get(w, 1)
    if not w:
        return 0
    if len(w) <= 3:
        return 1
    w = re.sub(r"(?:[^laeiouy]es|ed|[^laeiouy]e)$", "", w)
    w = re.sub(r"^y", "", w)
    return max(1, len(re.findall(r"[aeiouy]{1,2}", w)))


def spoken_words(text):
    return normalise(text)


# ---------------- audio ----------------
def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def probe(path):
    r = run([FFPROBE, "-v", "error", "-show_entries", "stream=codec_name,channels,sample_rate,bits_per_sample:format=duration", "-of", "json", path])
    if r.returncode != 0:
        return {"error": r.stderr.strip()[:200]}
    j = json.loads(r.stdout)
    st = (j.get("streams") or [{}])[0]
    return {"codec": st.get("codec_name"), "channels": st.get("channels"), "sampleRate": int(st.get("sample_rate", 0)), "bits": st.get("bits_per_sample"), "duration": float(j["format"]["duration"])}


def ebur128(path):
    r = run([FFMPEG, "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"])
    txt = r.stderr
    summ = txt[txt.rfind("Summary:"):]
    i = re.search(r"I:\s+(-?[\d.]+|-inf) LUFS", summ)
    tp = re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", summ)
    f = lambda m: (float("-inf") if m.group(1) == "-inf" else float(m.group(1))) if m else None
    return {"lufsI": f(i), "truePeak": f(tp)}


def silences(path, duration, noise=-45, min_d=0.05):
    r = run([FFMPEG, "-hide_banner", "-nostats", "-i", path, "-af", f"silencedetect=noise={noise}dB:d={min_d}", "-f", "null", "-"])
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: (-?[\d.]+)", r.stderr)]
    segs = []
    for k, s in enumerate(starts):
        e = ends[k] if k < len(ends) else duration
        segs.append((max(0.0, s), min(duration, e)))
    lead = next((e - s for s, e in segs if s <= 0.005), 0.0)
    tail = next((e - s for s, e in segs if e >= duration - 0.005), 0.0)
    internal = [e - s for s, e in segs if s > 0.005 and e < duration - 0.005]
    return {"leadMs": round(lead * 1000), "tailMs": round(tail * 1000), "maxInternalMs": round(max(internal, default=0) * 1000), "voiced": max(0.01, duration - lead - tail)}


# ---------------- main ----------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "assets-src", "vo"))
    ap.add_argument("--json", default=os.path.join(HERE, "reports", "qa-independent.json"))
    ap.add_argument("--only", default=None)
    ap.add_argument("--no-stt", action="store_true")
    a = ap.parse_args()
    out = os.path.abspath(a.out)

    script = json.load(open(os.path.join(HERE, "lines.json")))
    manifest = json.load(open(os.path.join(out, "manifest.json")))
    lines = script["lines"]
    voiced = [l for l in lines if not l.get("hold")]
    only = set(a.only.split(",")) if a.only else None

    # 1. coverage
    cov = {"scriptLines": len(lines), "held": [l["id"] for l in lines if l.get("hold")], "problems": []}
    mids = {}
    for m in manifest["lines"]:
        mids.setdefault(m["id"], []).append(m)
    for l in lines:
        ms = mids.get(l["id"], [])
        if len(ms) != 1:
            cov["problems"].append(f"{l['id']}: {len(ms)} manifest entries")
            continue
        m = ms[0]
        if l.get("hold"):
            if m.get("file"):
                cov["problems"].append(f"{l['id']}: held but has a file")
            continue
        if not m.get("file") or not os.path.exists(os.path.join(out, m["file"])):
            cov["problems"].append(f"{l['id']}: file missing ({m.get('file')})")
        elif m["file"] != f"{l['role']}/{l['id']}.wav":
            cov["problems"].append(f"{l['id']}: unexpected path {m['file']}")
    for mid in mids:
        if mid not in {l["id"] for l in lines}:
            cov["problems"].append(f"{mid}: in manifest, not in lines.json")
    known = {f"{l['role']}/{l['id']}.wav" for l in voiced}
    for role in ("advisor", "anchor"):
        for f in sorted(os.listdir(os.path.join(out, role))):
            if f.endswith(".wav") and f"{role}/{f}" not in known:
                cov["problems"].append(f"orphan file {role}/{f}")
            if not (f.endswith(".wav") or f.endswith(".gen.json")):
                cov["problems"].append(f"unexpected file {role}/{f}")

    # role reference syllables/word (from the script, this counter)
    ref_spw = {}
    for role in ("advisor", "anchor"):
        ws = [w for l in voiced if l["role"] == role for w in spoken_words(l.get("tts") or l["text"])]
        ref_spw[role] = sum(syllables(w) for w in ws) / max(1, len(ws))

    model = None
    if not a.no_stt:
        from faster_whisper import WhisperModel
        model = WhisperModel("base.en", device="cpu", compute_type="int8", download_root=os.path.join(HERE, ".cache", "whisper"), cpu_threads=4)

    results = []
    for l in voiced:
        if only and l["id"] not in only:
            continue
        path = os.path.join(out, l["role"], f"{l['id']}.wav")
        r = {"id": l["id"], "role": l["role"], "text": l["text"], "fails": [], "notes": []}
        if not os.path.exists(path):
            r["fails"].append("missing file")
            results.append(r)
            continue
        p = probe(path)
        r["probe"] = p
        if "error" in p:
            r["fails"].append(f"does not decode: {p['error']}")
            results.append(r)
            continue
        if p["channels"] != 1:
            r["fails"].append(f"{p['channels']} channels")
        if not 44100 <= p["sampleRate"] <= 48000:
            r["fails"].append(f"sample rate {p['sampleRate']}")
        if p["duration"] > 8:
            r["fails"].append(f"duration {p['duration']:.2f} s > 8 s")
        if p["duration"] < 1.2:
            words_n = len(l["text"].split())
            (r["notes"] if words_n <= 3 else r["fails"]).append(f"duration {p['duration']:.2f} s < 1.2 s ({words_n}-word line)")
        lo = ebur128(path)
        r.update(lo)
        if lo["truePeak"] is None or lo["truePeak"] > -0.5:
            r["fails"].append(f"true peak {lo['truePeak']} dBTP > -0.5")
        si = silences(path, p["duration"])
        r["silence"] = si
        if si["leadMs"] > 300:
            r["fails"].append(f"leading silence {si['leadMs']} ms")
        if si["tailMs"] > 300:
            r["fails"].append(f"trailing silence {si['tailMs']} ms")
        if si["maxInternalMs"] > 700:
            r["fails"].append(f"internal silence {si['maxInternalMs']} ms")
        words = spoken_words(l.get("tts") or l["text"])
        syl = sum(syllables(w) for w in words)
        r["rawWpm"] = round(len(words) / si["voiced"] * 60, 1)
        r["paceEq"] = round(syl / si["voiced"] * 60 / ref_spw[l["role"]], 1)
        if not GATE[0] <= r["paceEq"] <= GATE[1]:
            r["fails"].append(f"pace {r['paceEq']} wpm-eq outside {GATE[0]}-{GATE[1]}")
        elif not PACE[l["role"]][0] <= r["paceEq"] <= PACE[l["role"]][1]:
            r["notes"].append(f"pace {r['paceEq']} wpm-eq outside the {l['role']} target {PACE[l['role']][0]}-{PACE[l['role']][1]}")
        if not GATE[0] <= r["rawWpm"] <= GATE[1]:
            r["notes"].append(f"raw {r['rawWpm']} wpm (word-length effect; wpm-eq {r['paceEq']})")
        gp = os.path.join(out, l["role"], f"{l['id']}.gen.json")
        g = json.load(open(gp)) if os.path.exists(gp) else {}
        r["provider"], r["model"], r["voice"] = g.get("provider"), g.get("model"), (g.get("voice") or {}).get("id") if isinstance(g.get("voice"), dict) else g.get("voice")
        if model is not None:
            segs, _ = model.transcribe(path, language="en", beam_size=5, temperature=0.0, vad_filter=True, condition_on_previous_text=False)
            hyp = " ".join(s.text.strip() for s in segs).strip()
            r["transcript"] = hyp
            r["wer"] = round(wer(normalise(l["text"]), normalise(hyp)), 3)
            if r["wer"] > 0.15:
                r["fails"].append(f"WER {r['wer']:.0%}: heard {hyp!r}")
            elif r["wer"] > 0:
                r["notes"].append(f"WER {r['wer']:.0%}: heard {hyp!r}")
            if re.search(r"magnate", l["text"], re.I):
                heard = "magnate" if re.search(r"magnate", hyp, re.I) else ("MAGNET" if re.search(r"magnet", hyp, re.I) else "neither")
                r["magnate"] = heard
                if heard != "magnate":
                    r["fails"].append(f"'magnate' heard as {heard}: {hyp!r}")
        results.append(r)
        print(f"{'FAIL' if r['fails'] else 'ok  '} {l['id']}: {'; '.join(r['fails'] + r['notes'])}", flush=True)

    # 5./6. per-role consistency
    roles = {}
    for role in ("advisor", "anchor"):
        rs = [r for r in results if r["role"] == role and r.get("lufsI") is not None]
        if not rs:
            continue
        lu = [r["lufsI"] for r in rs]
        roles[role] = {
            "lines": len(rs),
            "lufsMin": min(lu), "lufsMax": max(lu), "lufsSpread": round(max(lu) - min(lu), 1),
            "providers": sorted({str(r["provider"]) for r in rs}), "models": sorted({str(r["model"]) for r in rs}), "voices": sorted({str(r["voice"]) for r in rs}),
            "paceEqMean": round(sum(r["paceEq"] for r in rs) / len(rs), 1), "paceEqMin": min(r["paceEq"] for r in rs), "paceEqMax": max(r["paceEq"] for r in rs),
            "rawWpmMin": min(r["rawWpm"] for r in rs), "rawWpmMax": max(r["rawWpm"] for r in rs),
            "maxTruePeak": max(r["truePeak"] for r in rs), "maxInternalSilenceMs": max(r["silence"]["maxInternalMs"] for r in rs),
            "refSyllablesPerWord": round(ref_spw[role], 3),
            "totalSeconds": round(sum(r["probe"]["duration"] for r in rs), 1),
            "problems": [],
        }
        if roles[role]["lufsSpread"] > 4:
            roles[role]["problems"].append(f"LUFS spread {roles[role]['lufsSpread']} LU > 4")
        for k in ("providers", "models", "voices"):
            if len(roles[role][k]) != 1:
                roles[role]["problems"].append(f"{len(roles[role][k])} {k}: {roles[role][k]}")

    failing = [r for r in results if r["fails"]]
    report = {
        "checked": len(results), "passing": len(results) - len(failing), "failing": [{"id": r["id"], "fails": r["fails"]} for r in failing],
        "coverage": cov, "roles": roles, "stt": None if model is None else "faster-whisper base.en, VAD on, beam 5, no prompt", "lines": results,
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.json)), exist_ok=True)
    with open(a.json, "w") as f:
        json.dump(report, f, indent=1)
        f.write("\n")
    print(json.dumps({k: report[k] for k in ("checked", "passing", "failing")}, indent=1))
    print(json.dumps({"coverage": cov["problems"], "roles": {k: v["problems"] for k, v in roles.items()}}, indent=1))
    sys.exit(1 if failing or cov["problems"] or any(v["problems"] for v in roles.values()) else 0)


if __name__ == "__main__":
    main()
