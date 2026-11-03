"""Step 3: transcript(+speakers) -> insights.json (heat curve, highlights, summary, action items).

Heat is computed from signals only; the LLM (claude -p) is used for highlights/summary and
never assigns owners: owner is the speaker label of the segment the LLM cites.
"""
import json, os, sys, pathlib
import edits
import harness

tr_path, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
kind = sys.argv[3] if len(sys.argv) > 3 else "meeting"  # meeting | lecture | recording
lang = json.loads(os.environ.get("MEETING_HARNESS") or "{}").get("lang", "auto")
tr = edits.apply(json.loads(tr_path.read_text()), tr_path)
segs = tr["segments"]
dur = max(tr.get("duration", 0), segs[-1]["end"] if segs else 0)
BIN = 30.0
nb = int(dur // BIN) + 1

# --- heat: 每 30 秒 bin 的發言密度、說話者切換、重疊發言 ---
speech = [0.0] * nb
switches = [0] * nb
overlap = [0.0] * nb
prev = None
for s in segs:
    b = min(int(s["start"] // BIN), nb - 1)
    speech[b] += s["end"] - s["start"]
    if prev is not None and s.get("spk") != prev:
        switches[b] += 1
    prev = s.get("spk")
turns = sorted(tr.get("turns", []), key=lambda x: x["s"])
for i, a in enumerate(turns):
    for b in turns[i + 1:]:
        if b["s"] >= a["e"]:
            break
        o = min(a["e"], b["e"]) - b["s"]
        if o > 0 and a["spk"] != b["spk"]:
            overlap[min(int(b["s"] // BIN), nb - 1)] += o


def norm(v):
    m = max(v) or 1
    return [x / m for x in v]


ns, nw, no = norm(speech), norm(switches), norm(overlap)
heat = [{"t": i * BIN, "score": round(0.4 * ns[i] + 0.4 * nw[i] + 0.2 * no[i], 4),
         "speech": round(speech[i], 1), "switches": switches[i], "overlap": round(overlap[i], 1)}
        for i in range(nb)]

# --- LLM: highlights + summary ---
def mmss(t):
    return f"{int(t // 60):02d}:{int(t % 60):02d}"


lines = [f"[{mmss(s['start'])}|{s.get('spk', '?')}] {s['text']}" for s in segs]
LANG = {"auto": "the same language as the transcript", "en": "English", "zh-TW": "Traditional Chinese"}.get(lang, lang)
SCHEMAS = {
    "meeting": (
        'a meeting', 'decision|action|question|risk|insight',
        '"action_items": [{"t": seconds, "text": "task", "speaker": "speaker label who raised it"}]',
        "Focus on decisions, owners of tasks, open questions and risks."),
    "lecture": (
        'a lecture or course session', 'definition|example|key_point|exam|question',
        '"action_items": [{"t": seconds, "text": "assignment, deadline or reading mentioned", "speaker": "S0"}],\n'
        ' "concepts": [{"t": seconds, "term": "term", "definition": "one-sentence definition as taught"}]',
        "Focus on the teaching structure: chapters (topics), key concepts with definitions, worked examples, "
        "hints about exams, and student questions. action_items are only assignments, deadlines and readings."),
    "recording": (
        'a recording', 'key_point|decision|question|insight',
        '"action_items": [{"t": seconds, "text": "follow-up mentioned", "speaker": "S0"}]',
        "Focus on the main points and any follow-ups."),
}
what, types, extra_schema, focus = SCHEMAS.get(kind, SCHEMAS["meeting"])
prompt = f"""Below is the transcript of {what}, one line per segment as [mm:ss|speaker] text.
Reply with exactly one JSON object and nothing else (no prose, no code fence):
{{"title": "short title",
 "summary": "5-8 sentence summary",
 "topics": [{{"t": seconds, "title": "chapter or topic"}}],
 "highlights": [{{"t": seconds, "type": "{types}", "title": "one sentence", "speaker": "S0"}}],
 {extra_schema}}}
Rules: write all text values in {LANG}. t must come from the transcript timestamps (converted to seconds).
speaker must be a label that appears in the transcript; never guess real names. Use empty arrays when nothing applies.
{focus}
Transcript:
""" + "\n".join(lines)

txt = harness.run(prompt).strip()
txt = txt[txt.find("{"): txt.rfind("}") + 1]
llm = json.loads(txt)

out.write_text(json.dumps({"source": tr["source"], "kind": kind, "duration": dur, "bin": BIN,
                           "heat": heat, **llm}, ensure_ascii=False, indent=1))
top = sorted(heat, key=lambda h: -h["score"])[:3]
print(f"highlights={len(llm.get('highlights', []))} actions={len(llm.get('action_items', []))} "
      f"hot={[mmss(h['t']) for h in top]}")
