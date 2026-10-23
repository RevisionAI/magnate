#!/usr/bin/env python3
"""Local speech-to-text for VO QA (faster-whisper on CPU, no network after the first model download).

Usage (normally called by generate.mjs):
    .venv/bin/python stt.py --in list.json --out transcripts.json [--model base.en]
    .venv/bin/python stt.py --serve [--model base.en]      # JSON lines: {"key","path"} on stdin -> result on stdout
    .venv/bin/python stt.py file1.wav file2.mp3 ...        # quick look, prints to stdout

list.json is `[{"key": "...", "path": "/abs/file.wav"}, ...]`.
The output is `{"model": ..., "results": {key: {"text", "words": [{"w", "p", "s", "e"}], "avgLogprob"}}}`.

The model is cached in tools/voice/.cache/whisper (gitignored). No prompt is given to the decoder on purpose:
priming it with the expected script would hide mispronunciations such as "magnate" -> "magnet".
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache", "whisper")


def load_model(name):
    from faster_whisper import WhisperModel

    os.makedirs(CACHE, exist_ok=True)
    threads = max(1, min(8, (os.cpu_count() or 4) // 2))
    return WhisperModel(name, device="cpu", compute_type="int8", download_root=CACHE, cpu_threads=threads)


def hallucinated_tail(seg):
    """Whisper base.en sometimes keeps "talking" into the silent padding after a short clip ("We'll see you next
    week." x3, "There you go."). Those trailing segments carry a raised no-speech probability and an impossible word
    rate or a repetitive text; real speech segments here sit at no_speech_prob ~0.003 and 2-4 words/s."""
    n_words = len(seg.words or []) or len(seg.text.split())
    wps = n_words / max(seg.end - seg.start, 0.01)
    return seg.no_speech_prob > 0.1 and (wps > 8 or seg.compression_ratio > 2.4)


def transcribe(model, path):
    segments, _info = model.transcribe(
        path,
        language="en",
        beam_size=5,
        temperature=0.0,
        vad_filter=False,
        condition_on_previous_text=False,
        word_timestamps=True,
    )
    segments = list(segments)
    dropped = []
    while len(segments) > 1 and hallucinated_tail(segments[-1]):
        dropped.insert(0, segments.pop().text.strip())
    text_parts, words, logprobs = [], [], []
    for seg in segments:
        text_parts.append(seg.text.strip())
        logprobs.append(seg.avg_logprob)
        for w in seg.words or []:
            words.append({"w": w.word.strip(), "p": round(w.probability, 3), "s": round(w.start, 3), "e": round(w.end, 3)})
    out = {
        "text": " ".join(t for t in text_parts if t).strip(),
        "words": words,
        "avgLogprob": round(sum(logprobs) / len(logprobs), 4) if logprobs else None,
    }
    if dropped:
        out["droppedTail"] = " ".join(dropped)
    return out


def serve(model_name):
    """Keeps the model loaded and answers one JSON line per request (generate.mjs transcribes Kokoro takes as they render)."""
    model = load_model(model_name)
    print(json.dumps({"ready": True, "model": model_name}), flush=True)
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        req = json.loads(raw)
        try:
            res = transcribe(model, req["path"])
        except Exception as e:  # the caller treats an error as "unverified"
            res = {"error": str(e)}
        res["key"] = req["key"]
        print(json.dumps(res), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp")
    ap.add_argument("--out")
    ap.add_argument("--model", default="base.en")
    ap.add_argument("--serve", action="store_true")
    ap.add_argument("files", nargs="*")
    a = ap.parse_args()
    if a.serve:
        serve(a.model)
        return

    items = []
    if a.inp:
        with open(a.inp) as f:
            items = json.load(f)
    items += [{"key": p, "path": p} for p in a.files]
    if not items:
        ap.error("nothing to transcribe")

    t0 = time.time()
    model = load_model(a.model)
    results = {}
    for i, it in enumerate(items):
        try:
            results[it["key"]] = transcribe(model, it["path"])
        except Exception as e:  # keep going; the caller treats a missing transcript as "unverified"
            results[it["key"]] = {"error": str(e)}
        if a.out and (i + 1) % 25 == 0:
            print(f"stt {i + 1}/{len(items)}", file=sys.stderr, flush=True)
    out = {"model": a.model, "engine": "faster-whisper", "seconds": round(time.time() - t0, 1), "results": results}
    if a.out:
        with open(a.out, "w") as f:
            json.dump(out, f, indent=1)
    else:
        for k, v in results.items():
            print(f"{os.path.basename(k)}\t{v.get('text', v.get('error'))}")


if __name__ == "__main__":
    main()
