"""AI proofreading of an ASR transcript: propose corrections, never apply them.

usage: proofread.py <spk.json> <out.json> [--terms "a, b, c"] [--limit N]
out.json = [{"i": line_index, "from": text, "to": text, "why": short reason}, ...]   (only lines that need a change)
Prints 'PROGRESS <0..1>' per finished batch.
"""
import argparse, json, pathlib, sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import edits
import harness

ap = argparse.ArgumentParser()
ap.add_argument("spk"); ap.add_argument("out")
ap.add_argument("--terms", default=""); ap.add_argument("--limit", type=int, default=0)
a = ap.parse_args()

tr = edits.apply(json.loads(pathlib.Path(a.spk).read_text()), a.spk)
segs = tr["segments"][: a.limit] if a.limit else tr["segments"]
d = pathlib.Path(a.spk).parent
ins = json.loads((d / "insights.json").read_text()) if (d / "insights.json").exists() else {}
names = json.loads((d / "speakers.json").read_text()) if (d / "speakers.json").exists() else {}
ctx = []
if ins.get("title"):
    ctx.append(f"Recording topic: {ins['title']}")
if ins.get("summary"):
    ctx.append(f"Summary: {ins['summary'][:600]}")
if names:
    ctx.append("Speaker names: " + ", ".join(sorted(set(names.values()))))
if a.terms.strip():
    ctx.append("Terms and spellings to prefer (names, products, jargon): " + a.terms.strip())
BATCH, WORKERS, OVERLAP = 70, 4, 3


def ask(lo: int, hi: int) -> list[dict]:
    before = [f"{i}: {segs[i]['text']}" for i in range(max(0, lo - OVERLAP), lo)]
    lines = [f"{i}: {segs[i]['text']}" for i in range(lo, hi)]
    prompt = (
        "You are proofreading an automatic speech-recognition (ASR) transcript, one numbered line per utterance.\n"
        "Fix ONLY clear recognition mistakes: wrong homophones or mis-heard words (use the context and the terms below), "
        "broken technical terms or names, obvious typos. Keep the speaker's wording, colloquialisms, fillers and language "
        "(including mixed Chinese/English). Do NOT paraphrase, summarize, merge, split, reorder, translate or add punctuation "
        "for style. If a line is plausible as it is, leave it out.\n"
        + ("\n".join(ctx) + "\n" if ctx else "")
        + ("Preceding lines, context only (do not return them):\n" + "\n".join(before) + "\n" if before else "")
        + "Lines to proofread:\n" + "\n".join(lines) + "\n\n"
        'Reply with exactly one JSON array and nothing else (no prose, no code fence): '
        '[{"i": <line number>, "to": "<corrected full line>", "why": "<few words>"}], only for lines that change; [] if none.'
    )
    txt = harness.run(prompt).strip()
    arr = json.loads(txt[txt.find("["): txt.rfind("]") + 1])
    out = []
    for x in arr:
        i, to = x.get("i"), x.get("to")
        if not isinstance(i, int) or not isinstance(to, str) or not (lo <= i < hi):
            continue
        old = segs[i]["text"]
        to = to.strip()
        # guard against rewrites: must differ, and stay close in length (a correction, not a paraphrase)
        if to and to != old and abs(len(to) - len(old)) <= max(4, 0.4 * len(old)):
            out.append({"i": i, "from": old, "to": to, "why": str(x.get("why", ""))[:80]})
    return out


starts = list(range(0, len(segs), BATCH))
res: dict[int, list[dict]] = {}
with ThreadPoolExecutor(WORKERS) as ex:
    futs = {ex.submit(ask, s, min(s + BATCH, len(segs))): s for s in starts}
    for n, f in enumerate(as_completed(futs), 1):
        res[futs[f]] = f.result()
        print(f"PROGRESS {n / len(starts):.4f}", flush=True)
flat = sorted((x for s in starts for x in res[s]), key=lambda x: x["i"])
pathlib.Path(a.out).write_text(json.dumps(flat, ensure_ascii=False))
print(f"{len(flat)} suggestion(s) over {len(segs)} lines")
