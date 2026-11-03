"""User proofreading overlay: <dir>/edits.json = {"seg": {"<index>": {"text"?: str, "spk"?: str}}}.

The original transcript files are never modified; every consumer applies this overlay on read.
"""
import json
import pathlib


def apply(tr: dict, spk_json_path: str | pathlib.Path) -> dict:
    p = pathlib.Path(spk_json_path).parent / "edits.json"
    if not p.exists():
        return tr
    ed = json.loads(p.read_text()).get("seg", {})
    for k, patch in ed.items():
        i = int(k)
        if 0 <= i < len(tr["segments"]):
            s = tr["segments"][i]
            if "text" in patch:
                s["text"] = patch["text"]
            if "spk" in patch:
                s["spk"] = patch["spk"]
    return tr
