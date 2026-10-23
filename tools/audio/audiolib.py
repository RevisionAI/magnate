"""Shared helpers for the Magnate audio pipeline (tools/audio).

Everything here is deterministic and depends only on numpy + an ffmpeg >= 5 build
with libopus (macOS: /usr/local/bin/ffmpeg 7.1.1 from Homebrew; the Anaconda
ffmpeg 4.2 that may be first on PATH has no usable loudnorm/libopus and is skipped).

Conventions
-----------
* Audio is handled as float32 numpy arrays shaped (frames, channels) at 48 kHz.
* Loudness follows ITU-R BS.1770-4 / EBU R128 (K-weighting, 400 ms momentary blocks,
  75 % overlap, absolute gate -70 LUFS, relative gate -10 LU).
* "dual-mono" measurement: a mono file that is played through a stereo bus without a
  panner is duplicated into both channels, so it is perceived 3 dB louder than a
  single-channel BS.1770 measurement says. VO and non-positional SFX are measured
  dual-mono; positional (panned) mono loops are measured as single channel because
  an equal-power panner preserves power.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional, Sequence

import numpy as np

SR = 48_000

# ----------------------------------------------------------------------------- ffmpeg


class ToolError(RuntimeError):
    pass


def _version_ok(exe: str) -> bool:
    try:
        out = subprocess.run([exe, "-hide_banner", "-version"], capture_output=True, text=True, timeout=20).stdout
        enc = subprocess.run([exe, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    m = re.search(r"ffmpeg version n?(\d+)\.", out)
    return bool(m) and int(m.group(1)) >= 5 and "libopus" in enc


def find_ffmpeg() -> tuple[str, str]:
    """Return (ffmpeg, ffprobe) paths. Honours $FFMPEG / $FFPROBE."""
    candidates: list[str] = []
    if os.environ.get("FFMPEG"):
        candidates.append(os.environ["FFMPEG"])
    candidates += ["/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/bin/ffmpeg"]
    on_path = shutil.which("ffmpeg")
    if on_path:
        candidates.append(on_path)
    for exe in candidates:
        if exe and Path(exe).exists() and _version_ok(exe):
            probe = os.environ.get("FFPROBE") or str(Path(exe).with_name("ffprobe"))
            if not Path(probe).exists():
                probe = shutil.which("ffprobe") or "ffprobe"
            return exe, probe
    raise ToolError("No suitable ffmpeg (>= 5 with libopus) found. Set $FFMPEG.")


FFMPEG, FFPROBE = find_ffmpeg()


def run(args: Sequence[str], *, input_bytes: Optional[bytes] = None) -> subprocess.CompletedProcess:
    proc = subprocess.run(list(args), input=input_bytes, capture_output=True)
    if proc.returncode != 0:
        tail = proc.stderr.decode("utf-8", "replace")[-2000:]
        raise ToolError(f"command failed ({proc.returncode}): {' '.join(args)}\n{tail}")
    return proc


def has_encoder(name: str) -> bool:
    out = subprocess.run([FFMPEG, "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    return re.search(rf"^\s*A\S*\s+{re.escape(name)}\s", out, re.M) is not None


# ----------------------------------------------------------------------------- PCM I/O


def decode(path: Path | str, channels: int, sr: int = SR) -> np.ndarray:
    """Decode any file to float32 (frames, channels) at `sr` using the soxr resampler."""
    proc = run(
        [
            FFMPEG, "-v", "error", "-nostdin", "-i", str(path),
            "-af", f"aresample={sr}:resampler=soxr:precision=28",
            "-ac", str(channels), "-f", "f32le", "-acodec", "pcm_f32le", "-",
        ]
    )
    data = np.frombuffer(proc.stdout, dtype="<f4").astype(np.float32)
    return data.reshape(-1, channels)


def write_wav(path: Path | str, audio: np.ndarray, sr: int = SR) -> None:
    """Write float32 PCM to a WAV via ffmpeg (keeps us free of soundfile)."""
    audio = np.ascontiguousarray(audio, dtype="<f4")
    run(
        [
            FFMPEG, "-v", "error", "-nostdin", "-y", "-f", "f32le", "-ar", str(sr), "-ac", str(audio.shape[1]),
            "-i", "-", "-c:a", "pcm_f32le", str(path),
        ],
        input_bytes=audio.tobytes(),
    )


def ffmpeg_filter(audio: np.ndarray, chain: str, sr: int = SR) -> np.ndarray:
    """Run float PCM through an ffmpeg -af chain and return float PCM (same channel count)."""
    ch = audio.shape[1]
    audio = np.ascontiguousarray(audio, dtype="<f4")
    proc = run(
        [
            FFMPEG, "-v", "error", "-nostdin", "-f", "f32le", "-ar", str(sr), "-ac", str(ch), "-i", "-",
            "-af", chain, "-ar", str(sr), "-ac", str(ch), "-f", "f32le", "-acodec", "pcm_f32le", "-",
        ],
        input_bytes=audio.tobytes(),
    )
    return np.frombuffer(proc.stdout, dtype="<f4").astype(np.float32).reshape(-1, ch)


def md5_file(path: Path | str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def sha1_json(obj) -> str:
    return hashlib.sha1(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


# ----------------------------------------------------------------------------- loudness (BS.1770-4)

# K-weighting biquads for 48 kHz (BS.1770-4 Annex 1, Tables 1 and 2).
_K1_B = np.array([1.53512485958697, -2.69169618940638, 1.19839281085285])
_K1_A = np.array([1.0, -1.69065929318241, 0.73248077421585])
_K2_B = np.array([1.0, -2.0, 1.0])
_K2_A = np.array([1.0, -1.99004745483398, 0.99007225036621])


def _biquad(x: np.ndarray, b: np.ndarray, a: np.ndarray) -> np.ndarray:
    from scipy.signal import lfilter  # scipy is optional for callers that never measure

    return lfilter(b, a, x, axis=0)


def k_weight(audio: np.ndarray) -> np.ndarray:
    return _biquad(_biquad(audio.astype(np.float64), _K1_B, _K1_A), _K2_B, _K2_A)


@dataclass
class Loudness:
    integrated: float  # LUFS-I (gated); -inf for silence
    momentary_max: float  # max 400 ms block loudness (LUFS-M max)
    true_peak: float  # dBTP (4x oversampled)
    sample_peak: float  # dBFS
    duration: float

    def as_dict(self) -> dict:
        r = lambda v: None if not math.isfinite(v) else round(v, 2)  # noqa: E731
        return {
            "lufsI": r(self.integrated),
            "mMax": r(self.momentary_max),
            "truePeak": r(self.true_peak),
            "samplePeak": r(self.sample_peak),
        }


def _blocks(power: np.ndarray, sr: int) -> np.ndarray:
    """Mean-square per 400 ms block with a 100 ms hop. power: (frames, ch) of y^2."""
    block, hop = int(0.4 * sr), int(0.1 * sr)
    n = power.shape[0]
    if n < block:
        power = np.vstack([power, np.zeros((block - n, power.shape[1]))])
        n = block
    csum = np.vstack([np.zeros((1, power.shape[1])), np.cumsum(power, axis=0)])
    starts = np.arange(0, n - block + 1, hop)
    return (csum[starts + block] - csum[starts]) / block  # (blocks, ch)


def true_peak_db(audio: np.ndarray) -> float:
    from scipy.signal import resample_poly

    up = resample_poly(audio.astype(np.float64), 4, 1, axis=0)
    peak = float(np.max(np.abs(up))) if up.size else 0.0
    return 20 * math.log10(peak) if peak > 0 else -math.inf


def measure(audio: np.ndarray, sr: int = SR, *, dual_mono: bool = False) -> Loudness:
    """BS.1770-4 integrated + momentary max + true peak for (frames, ch) audio at 48 kHz."""
    if sr != SR:
        raise ValueError("measure() expects 48 kHz audio")
    weighted = k_weight(audio)
    z = _blocks(weighted * weighted, sr)
    weights = np.ones(audio.shape[1])
    if dual_mono and audio.shape[1] == 1:
        weights = weights * 2.0  # mono duplicated to L+R
    block_power = z @ weights
    with np.errstate(divide="ignore"):
        block_lufs = -0.691 + 10 * np.log10(block_power)
    m_max = float(np.max(block_lufs)) if block_lufs.size else -math.inf
    gated = block_power[block_lufs > -70.0]
    if gated.size == 0:
        integrated = -math.inf
    else:
        rel = -0.691 + 10 * math.log10(float(np.mean(gated))) - 10.0
        g2 = block_power[(block_lufs > -70.0) & (block_lufs > rel)]
        integrated = -0.691 + 10 * math.log10(float(np.mean(g2))) if g2.size else -math.inf
    sp = float(np.max(np.abs(audio))) if audio.size else 0.0
    return Loudness(
        integrated=integrated,
        momentary_max=m_max,
        true_peak=true_peak_db(audio),
        sample_peak=20 * math.log10(sp) if sp > 0 else -math.inf,
        duration=audio.shape[0] / sr,
    )


_EBU_FRAME = re.compile(r"\bM:\s*(-?[\d.]+|-inf)")
_EBU_I = re.compile(r"Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+|-inf)\s*LUFS")
_EBU_TP = re.compile(r"True peak:\s*\n\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS")


def ffmpeg_ebur128(path: Path | str, *, dual_mono: bool = False) -> dict:
    """The official numbers: ffmpeg's ebur128 filter on the delivered (decoded) file."""
    flt = "ebur128=peak=true:framelog=info" + (":dualmono=true" if dual_mono else "")
    proc = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostats", "-nostdin", "-i", str(path), "-af", flt, "-f", "null", "-"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise ToolError(f"ebur128 failed for {path}: {proc.stderr[-800:]}")
    err = proc.stderr
    ms = [float(v) for v in _EBU_FRAME.findall(err) if v != "-inf"]
    mi, mtp = _EBU_I.search(err), _EBU_TP.search(err)
    to_f = lambda m: (float(m.group(1)) if m and m.group(1) != "-inf" else -math.inf)  # noqa: E731
    return {"lufsI": to_f(mi), "mMax": max(ms) if ms else -math.inf, "truePeak": to_f(mtp)}


# ----------------------------------------------------------------------------- loops


def bake_seam(audio: np.ndarray, start: int, end: int, xf: int) -> np.ndarray:
    """Equal-power crossfade the last `xf` frames before `end` with the audio before `start`.

    After this, a plain loopStart/loopEnd wrap is seamless: the samples leading up to
    `end` converge on the samples leading up to `start`, so wrapping from `end` to `start`
    continues exactly as the original continuation through `start` would.
    """
    if not (xf <= start < end - xf <= audio.shape[0] - xf):
        raise ValueError(f"seam does not fit: start={start} end={end} xf={xf} len={audio.shape[0]}")
    out = audio.copy()
    theta = (np.arange(xf) + 0.5) / xf * (math.pi / 2)
    fade_out, fade_in = np.cos(theta)[:, None], np.sin(theta)[:, None]
    out[end - xf : end] = audio[end - xf : end] * fade_out + audio[start - xf : start] * fade_in
    return out


def _env_db(x: np.ndarray, sr: int, win: float = 0.05) -> np.ndarray:
    n = int(win * sr)
    mono = x.mean(axis=1) if x.ndim == 2 else x
    frames = mono[: (len(mono) // n) * n].reshape(-1, n)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1)) + 1e-9
    return 20 * np.log10(rms)


def _onsets(x: np.ndarray, sr: int, hop: float = 0.0116) -> np.ndarray:
    """Spectral-flux onset envelope (half-wave rectified log-magnitude flux)."""
    n_fft, h = 1024, int(hop * sr)
    mono = (x.mean(axis=1) if x.ndim == 2 else x).astype(np.float64)
    if len(mono) < n_fft + h:
        return np.zeros(1)
    win = np.hanning(n_fft)
    frames = np.lib.stride_tricks.sliding_window_view(mono, n_fft)[::h] * win
    mag = np.log1p(np.abs(np.fft.rfft(frames, axis=1)) * 10)
    flux = np.maximum(np.diff(mag, axis=0), 0).sum(axis=1)
    return flux


def _corr(a: np.ndarray, b: np.ndarray) -> float:
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    if n < 3 or np.std(a) < 1e-12 or np.std(b) < 1e-12:
        return 1.0
    return float(np.corrcoef(a, b)[0, 1])


def seam_qa(audio: np.ndarray, start: int, end: int, sr: int = SR, span: float = 4.0) -> dict:
    """Compare the wrapped stream around loopEnd->loopStart with the true continuation
    through loopStart (audio-plan section 2.5 acceptance: env r >= 0.93, onset r >= 0.85
    (0.75 non-rhythmic), mean |delta| <= 1.0 dB)."""
    n = int(span * sr)
    n = min(n, start, audio.shape[0] - start, end - start)
    wrapped = np.vstack([audio[end - n : end], audio[start : start + n]])
    reference = audio[start - n : start + n]
    ea, eb = _env_db(wrapped, sr), _env_db(reference, sr)
    oa, ob = _onsets(wrapped, sr), _onsets(reference, sr)
    # sample discontinuity at the wrap vs typical sample-to-sample motion
    jump = float(np.max(np.abs(audio[start] - audio[end - 1])))
    typical = float(np.percentile(np.abs(np.diff(audio[start - 4800 : start + 4800], axis=0)), 99))
    return {
        "envCorr": round(_corr(ea, eb), 3),
        "meanAbsDeltaDb": round(float(np.mean(np.abs(ea - eb))), 2),
        "maxAbsDeltaDb": round(float(np.max(np.abs(ea - eb))), 2),
        "onsetCorr": round(_corr(oa, ob), 3),
        "wrapJump": round(jump, 4),
        "wrapJumpP99": round(typical, 4),
    }


# ----------------------------------------------------------------------------- misc


def head_silence(audio: np.ndarray, sr: int = SR, threshold_db: float = -50.0) -> float:
    thr = 10 ** (threshold_db / 20)
    idx = np.nonzero(np.max(np.abs(audio), axis=1) > thr)[0]
    return (idx[0] / sr) if idx.size else audio.shape[0] / sr


def tail_silence(audio: np.ndarray, sr: int = SR, threshold_db: float = -60.0) -> float:
    thr = 10 ** (threshold_db / 20)
    idx = np.nonzero(np.max(np.abs(audio), axis=1) > thr)[0]
    return ((audio.shape[0] - 1 - idx[-1]) / sr) if idx.size else audio.shape[0] / sr


def stereo_width_db(audio: np.ndarray) -> float:
    """Side/mid energy ratio in dB (very negative = effectively mono)."""
    if audio.shape[1] < 2:
        return -math.inf
    mid = (audio[:, 0] + audio[:, 1]) * 0.5
    side = (audio[:, 0] - audio[:, 1]) * 0.5
    em, es = float(np.mean(mid.astype(np.float64) ** 2)), float(np.mean(side.astype(np.float64) ** 2))
    if es <= 0:
        return -math.inf
    return 10 * math.log10(es / max(em, 1e-20))


def fade(audio: np.ndarray, sr: int, fade_in: float = 0.0, fade_out: float = 0.0) -> np.ndarray:
    out = audio.copy()
    if fade_in > 0:
        n = min(int(fade_in * sr), out.shape[0])
        out[:n] *= np.linspace(0.0, 1.0, n, endpoint=False)[:, None]
    if fade_out > 0:
        n = min(int(fade_out * sr), out.shape[0])
        out[out.shape[0] - n :] *= np.linspace(1.0, 0.0, n)[:, None]
    return out


def rel(path: Path, root: Path) -> str:
    return str(Path(os.path.relpath(path, root))).replace(os.sep, "/")


def tmpdir() -> tempfile.TemporaryDirectory:
    return tempfile.TemporaryDirectory(prefix="magnate-audio-")


def iter_chunks(seq: Sequence, n: int) -> Iterable[Sequence]:
    for i in range(0, len(seq), n):
        yield seq[i : i + n]
