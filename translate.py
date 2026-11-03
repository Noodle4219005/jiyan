"""Translate subtitle cues with the configured harness.

usage: translate.py <cues.json (list[str])> <out.json (list[str])> <language name>
Prints 'PROGRESS <0..1>' after each finished batch.
"""
import json, re, sys, pathlib
from concurrent.futures import ThreadPoolExecutor, as_completed

import harness

cues = json.loads(pathlib.Path(sys.argv[1]).read_text())
out, lang = pathlib.Path(sys.argv[2]), sys.argv[3]
BATCH, WORKERS = 60, 4


def ask(lines: list[str], ctx: list[str]) -> list[str]:
    prompt = (
        f"Translate these subtitle lines into {lang}.\n"
        "Return exactly one JSON array of strings, with the same number of items in the same order, and nothing else "
        "(no prose, no code fence). Do not merge, split, drop or reorder lines. Keep proper nouns, product names and "
        "code terms as they are when a translation would be unnatural. Keep each line short enough for a subtitle.\n"
        + ("Preceding lines for context only (do NOT translate or return them):\n" + json.dumps(ctx, ensure_ascii=False) + "\n" if ctx else "")
        + "Lines to translate:\n" + json.dumps(lines, ensure_ascii=False)
    )
    txt = harness.run(prompt).strip()
    arr = json.loads(txt[txt.find("["): txt.rfind("]") + 1])
    if not isinstance(arr, list) or len(arr) != len(lines) or not all(isinstance(x, str) for x in arr):
        raise ValueError(f"expected {len(lines)} strings, got {len(arr) if isinstance(arr, list) else type(arr).__name__}")
    return arr


def translate(lines: list[str], ctx: list[str]) -> list[str]:
    try:
        return ask(lines, ctx)
    except Exception:
        if len(lines) == 1:
            raise
        h = len(lines) // 2  # misaligned or malformed reply: retry on halves
        return translate(lines[:h], ctx) + translate(lines[h:], lines[max(0, h - 3):h])


starts = list(range(0, len(cues), BATCH))
res: dict[int, list[str]] = {}
with ThreadPoolExecutor(WORKERS) as ex:
    futs = {ex.submit(translate, cues[s:s + BATCH], cues[max(0, s - 3):s]): s for s in starts}
    for n, f in enumerate(as_completed(futs), 1):
        res[futs[f]] = f.result()
        print(f"PROGRESS {n / len(starts):.4f}", flush=True)

flat = [t for s in starts for t in res[s]]
assert len(flat) == len(cues)
out.write_text(json.dumps(flat, ensure_ascii=False))
print(f"translated {len(flat)} cues to {lang}")
