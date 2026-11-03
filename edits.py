"""User proofreading overlay: <dir>/edits.json = {"seg": {"<index>": {"text"?, "spk"?}}, "merge": {"S3": "S0"}}.

"merge" means: speaker S3 is really the same person as S0 (diarization split one voice in two).
The original transcript files are never modified; every consumer applies this overlay on read.
"""
import json
import pathlib


def _load(spk_json_path: str | pathlib.Path) -> dict:
    p = pathlib.Path(spk_json_path).parent / "edits.json"
    return json.loads(p.read_text()) if p.exists() else {}


def canon(label: str | None, merge: dict) -> str | None:
    seen = set()
    while label in merge and label not in seen:  # follow S3 -> S0 (-> ...); the set guards against cycles
        seen.add(label)
        label = merge[label]
    return label


def apply(tr: dict, spk_json_path: str | pathlib.Path) -> dict:
    ed = _load(spk_json_path)
    merge = ed.get("merge", {})
    for s in tr["segments"]:
        s["spk"] = canon(s.get("spk"), merge)
    for t in tr.get("turns", []):
        t["spk"] = canon(t.get("spk"), merge)
    for k, patch in ed.get("seg", {}).items():
        i = int(k)
        if 0 <= i < len(tr["segments"]):
            s = tr["segments"][i]
            if "text" in patch:
                s["text"] = patch["text"]
            if "spk" in patch:
                s["spk"] = patch["spk"]
    return tr


def apply_insights(ins: dict | None, spk_json_path: str | pathlib.Path) -> dict | None:
    """Map highlight / action-item speaker labels through the merge table."""
    if not ins:
        return ins
    merge = _load(spk_json_path).get("merge", {})
    for key in ("highlights", "action_items"):
        for x in ins.get(key, []):
            if x.get("speaker"):
                x["speaker"] = canon(x["speaker"], merge)
    return ins
