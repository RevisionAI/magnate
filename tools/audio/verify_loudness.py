#!/usr/bin/env python3
"""Verify the delivered audio in web/public/audio against the manifest (audio-plan section 4.14 asset CI).

For every manifest asset, both formats must exist; the .ogg and the .m4a are decoded and measured with
ffmpeg's ebur128 filter (true-peak mode):
  * LUFS-I (music, VO, beds, loops) or LUFS-M max (SFX, stingers) within +-1 LU of the class target;
  * true peak at or below the class ceiling (the m4a gets +0.5 dB of grace for AAC overshoot);
  * SFX head silence <= 5 ms;
  * loops: envelope r >= 0.93, mean |delta| <= 1.0 dB, onset r >= 0.85 (audio-plan section 2.5);
  * the decoded .ogg length equals manifest lengthSamples (sample-exact Opus).
Prints a table and exits 1 on any failure. Usage: python3 tools/audio/verify_loudness.py [--json out.json]
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import audiolib as A  # noqa: E402

ROOT = HERE.parents[1]
OUT = ROOT / "web" / "public" / "audio"
MANIFEST = OUT / "manifest.json"
TOL = 1.0
M4A_TP_GRACE = 0.5


def main(argv: list[str]) -> int:
    manifest = json.loads(MANIFEST.read_text())
    classes = manifest["classes"]
    rows, failures = [], []
    for e in manifest["assets"]:
        cls = classes[e["class"]]
        dual = bool(e["loudness"].get("dualMono"))
        metric_key = "lufsI" if cls["metric"] == "I" else "mMax"
        row = {"id": e["id"] + (f".{e['variant']}" if e.get("variant") else ""), "class": e["class"],
               "metric": "LUFS-I" if metric_key == "lufsI" else "M-max", "target": cls["target"],
               "tpMax": cls["tpMax"]}
        for fmt in ("ogg", "m4a"):
            p = OUT / e["files"][fmt]
            if not p.exists():
                failures.append(f"{row['id']}: missing {fmt} {p}")
                continue
            m = A.ffmpeg_ebur128(p, dual_mono=dual)
            row[f"{fmt}Value"] = m[metric_key]
            row[f"{fmt}TP"] = m["truePeak"]
            if not math.isfinite(m[metric_key]) or abs(m[metric_key] - cls["target"]) > TOL:
                failures.append(f"{row['id']} [{fmt}]: {row['metric']} {m[metric_key]} vs target {cls['target']} +-{TOL}")
            grace = M4A_TP_GRACE if fmt == "m4a" else 0.0
            if m["truePeak"] > cls["tpMax"] + grace:
                failures.append(f"{row['id']} [{fmt}]: true peak {m['truePeak']} dBTP > {cls['tpMax'] + grace}")
        ogg = OUT / e["files"]["ogg"]
        if ogg.exists():
            decoded = A.decode(ogg, e["channels"])
            if decoded.shape[0] != e["lengthSamples"]:
                failures.append(f"{row['id']}: decoded {decoded.shape[0]} samples != manifest {e['lengthSamples']}")
            if e["kind"] == "sfx":
                hs = A.head_silence(decoded) * 1000
                row["headMs"] = round(hs, 1)
                if hs > 5.0:
                    failures.append(f"{row['id']}: head silence {hs:.1f} ms > 5 ms")
        if e.get("loop"):
            qa = e["loop"]["qa"]
            row["loopQA"] = qa
            if qa["envCorr"] < 0.93 or qa["meanAbsDeltaDb"] > 1.0 or qa["onsetCorr"] < 0.85:
                failures.append(f"{row['id']}: loop QA below acceptance {qa}")
        rows.append(row)

    print(f"{'asset':<34}{'class':<10}{'metric':<8}{'target':>7}{'ogg':>8}{'m4a':>8}{'TP ogg':>8}{'TP m4a':>8}{'TPmax':>7}")
    for r in rows:
        f = lambda v: "-" if v is None or (isinstance(v, float) and not math.isfinite(v)) else f"{v:.1f}"  # noqa: E731
        print(f"{r['id']:<34}{r['class']:<10}{r['metric']:<8}{r['target']:>7}{f(r.get('oggValue')):>8}{f(r.get('m4aValue')):>8}"
              f"{f(r.get('oggTP')):>8}{f(r.get('m4aTP')):>8}{r['tpMax']:>7}")
    for r in rows:
        if "loopQA" in r:
            print(f"loop {r['id']}: {r['loopQA']}")
    if "--json" in argv:
        Path(argv[argv.index("--json") + 1]).write_text(json.dumps({"rows": rows, "failures": failures}, indent=2))
    if failures:
        print("\nFAILED:")
        for msg in failures:
            print("  " + msg)
        return 1
    print(f"\nverify-loudness OK ({len(rows)} assets, {2 * len(rows)} files)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
