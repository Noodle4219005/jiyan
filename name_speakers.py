"""Suggest real names for speaker labels, only where the transcript itself gives evidence.

usage: name_speakers.py <spk.json> [out.json]   -> writes (and prints) one JSON object {"S0": {"name","evidence","t","confidence"}, ...}
"""
import json, pathlib, sys
import edits
import harness

tr = edits.apply(json.loads(pathlib.Path(sys.argv[1]).read_text()), sys.argv[1])
mm = lambda t: f"{int(t // 60):02d}:{int(t % 60):02d}"
labels = sorted({s.get("spk") for s in tr["segments"] if s.get("spk")})
lines = [f"[{mm(s['start'])}|{s.get('spk', '?')}] {s['text']}" for s in tr["segments"]]
prompt = f"""Below is a transcript with speaker labels ({', '.join(labels)}). Diarization labels are anonymous.
Decide who each label is, ONLY when the transcript gives direct evidence:
- the speaker introduces themself ("I'm X", "我是X");
- another speaker addresses them by name and they answer ("X, what do you think?" followed by that label speaking);
- a name is clearly assigned to them in context.
If there is no such evidence, leave the name empty. Never guess from the topic, voice or role.
Reply with exactly one JSON object and nothing else (no prose, no code fence):
{{"S0": {{"name": "" , "evidence": "short quote", "t": seconds, "confidence": "high|medium|low"}}, ...}}
Include every label. Write names exactly as they appear in the transcript (keep the original language).
Transcript:
""" + "\n".join(lines)
txt = harness.run(prompt).strip()
obj = json.loads(txt[txt.find("{"): txt.rfind("}") + 1])
res = json.dumps({k: obj.get(k, {"name": "", "evidence": "", "t": 0, "confidence": "low"}) for k in labels}, ensure_ascii=False)
if len(sys.argv) > 2:
    pathlib.Path(sys.argv[2]).write_text(res)
print(res)
