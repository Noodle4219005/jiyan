"""Jiyan (記言) MCP server over ~/MeetingNotes: lets Claude Code / Codex / pi query processed meetings and lectures.

Run (stdio):  uv run --project <repo> python mcp_server.py
Data root:    $MEETING_NOTES_DIR or ~/MeetingNotes
"""
import json
import os
import pathlib

import edits
from mcp.server.mcpserver import MCPServer

def _root() -> pathlib.Path:
    if os.environ.get("MEETING_NOTES_DIR"):
        return pathlib.Path(os.environ["MEETING_NOTES_DIR"]).expanduser()
    cfg = pathlib.Path("~/.config/jiyan/config.json").expanduser()  # written by the app's "Project folder" setting
    if cfg.exists():
        return pathlib.Path(json.loads(cfg.read_text()).get("dataDir", "~/MeetingNotes")).expanduser()
    return pathlib.Path("~/MeetingNotes").expanduser()

mcp = MCPServer("jiyan")


def _j(p: pathlib.Path):
    return json.loads(p.read_text()) if p.exists() else None


def _mm(t: float) -> str:
    return f"{int(t // 60):02d}:{int(t % 60):02d}"


def _ids() -> list[str]:
    return sorted((d.name for d in _root().iterdir() if (d / "meta.json").exists()), reverse=True) if _root().exists() else []


def _load(mid: str):
    d = _root() / mid
    if not (d / "meta.json").exists():
        raise ValueError(f"unknown meeting id {mid!r}; call list_meetings")
    tr = _j(d / "spk.json") or _j(d / "transcript.json")
    if tr:
        tr = edits.apply(tr, d / "spk.json")  # user's proofreading overlay
    ins = edits.apply_insights(_j(d / "insights.json"), d / "spk.json")  # same-person merges
    return _j(d / "meta.json"), tr, ins, (_j(d / "speakers.json") or {})


def _name(names: dict, s: str | None) -> str:
    return names.get(s or "", s or "?")


def _named(obj, names):
    """Return a copy of an insights item with its speaker label replaced by the user-given name."""
    o = dict(obj)
    if o.get("speaker"):
        o["speaker"] = _name(names, o["speaker"])
    return o


@mcp.tool()
def list_meetings() -> list[dict]:
    """List all processed recordings (meetings, lectures) newest first, with id, title, kind, stage and duration."""
    out = []
    for mid in _ids():
        meta, tr, ins, _ = _load(mid)
        out.append({"id": mid, "title": meta["title"], "ai_title": (ins or {}).get("title"), "kind": (ins or {}).get("kind", "?"),
                    "created": meta["created"], "duration_s": round((tr or {}).get("duration", 0)),
                    "stage": "analyzed" if ins else "transcribed" if tr else "new"})
    return out


@mcp.tool()
def get_meeting(meeting_id: str) -> dict:
    """Get the AI summary of one recording: summary, topics/chapters, highlights, action items, concepts (lectures),
    and speaker names. Timestamps `t` are seconds from the start."""
    meta, tr, ins, names = _load(meeting_id)
    if not ins:
        return {"id": meeting_id, "error": "not analyzed yet; run the AI analysis step in the app"}
    return {"id": meeting_id, "title": meta["title"], "ai_title": ins.get("title"), "kind": ins.get("kind"), "source": meta["source"],
            "speakers": {s: _name(names, s) for s in sorted({t["spk"] for t in (tr or {}).get("turns", [])} | {s.get("spk") for s in (tr or {}).get("segments", []) if s.get("spk")})},
            "summary": ins.get("summary"), "topics": ins.get("topics", []),
            "highlights": [_named(h, names) for h in ins.get("highlights", [])],
            "action_items": [_named(a, names) for a in ins.get("action_items", [])],
            "concepts": ins.get("concepts", [])}


@mcp.tool()
def get_transcript(meeting_id: str, start_s: float = 0, end_s: float | None = None, max_chars: int = 20000) -> str:
    """Return transcript lines '[mm:ss] Speaker: text' for the time range [start_s, end_s) (seconds)."""
    _, tr, _, names = _load(meeting_id)
    lines = [f"[{_mm(s['start'])}] {_name(names, s.get('spk'))}: {s['text']}" for s in (tr or {}).get("segments", [])
             if s["start"] >= start_s and (end_s is None or s["start"] < end_s)]
    text = "\n".join(lines)
    return text[:max_chars] + ("\n…[truncated; narrow the time range]" if len(text) > max_chars else "")


@mcp.tool()
def search(query: str, meeting_id: str | None = None, limit: int = 20) -> list[dict]:
    """Case-insensitive substring search over transcripts (and summaries). Returns meeting id, time and the matching line."""
    q = query.lower()
    hits = []
    for mid in [meeting_id] if meeting_id else _ids():
        meta, tr, ins, names = _load(mid)
        for s in (tr or {}).get("segments", []):
            if q in s["text"].lower():
                hits.append({"meeting_id": mid, "title": meta["title"], "t": round(s["start"]), "at": _mm(s["start"]),
                             "speaker": _name(names, s.get("spk")), "text": s["text"]})
        if ins and q in json.dumps(ins, ensure_ascii=False).lower() and q in (ins.get("summary") or "").lower():
            hits.append({"meeting_id": mid, "title": meta["title"], "t": 0, "at": "summary", "speaker": "-",
                         "text": ins["summary"][:300]})
    return hits[:limit]


@mcp.tool()
def list_action_items(meeting_id: str | None = None) -> list[dict]:
    """List action items (tasks for meetings; assignments/deadlines for lectures) across all recordings or one."""
    out = []
    for mid in [meeting_id] if meeting_id else _ids():
        meta, _, ins, names = _load(mid)
        for a in (ins or {}).get("action_items", []):
            out.append({"meeting_id": mid, "title": meta["title"], "at": _mm(a["t"]), **_named(a, names)})
    return out


@mcp.tool()
def get_hotspots(meeting_id: str, top: int = 5) -> list[dict]:
    """Return the most active 30-second windows (speech density, speaker switches, overlap) with nearby highlights."""
    _, _, ins, names = _load(meeting_id)
    if not ins:
        return []
    hl = ins.get("highlights", [])
    out = []
    for h in sorted(ins["heat"], key=lambda x: -x["score"])[:top]:
        near = [_named(x, names) for x in hl if h["t"] - 15 <= x["t"] < h["t"] + ins["bin"] + 15]
        out.append({"at": _mm(h["t"]), "t": h["t"], "score": h["score"], "switches": h["switches"],
                    "overlap_s": h["overlap"], "highlights": near})
    return out


if __name__ == "__main__":
    mcp.run()
