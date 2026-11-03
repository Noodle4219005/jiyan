"""Fast checks without models or network: proofreading overlay + MCP server over stdio, on a tiny fixture."""
import asyncio, json, os, pathlib, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import edits  # noqa: E402

tmp = pathlib.Path(tempfile.mkdtemp())
d = tmp / "m1"
d.mkdir()
segs = [{"start": 0, "end": 2, "text": "hello resort", "spk": "S0", "words": []},
        {"start": 3, "end": 5, "text": "next line", "spk": "S1", "words": []}]
(d / "meta.json").write_text(json.dumps({"id": "m1", "title": "T", "source": "x.mp4", "created": "2026-01-01T00:00:00Z"}))
(d / "spk.json").write_text(json.dumps({"source": "x.mp4", "duration": 5, "segments": segs, "turns": [{"s": 0, "e": 2, "spk": "S0"}, {"s": 3, "e": 5, "spk": "S1"}]}))
(d / "speakers.json").write_text(json.dumps({"S0": "Alice"}))
(d / "edits.json").write_text(json.dumps({"seg": {"0": {"text": "hello result"}}, "merge": {"S1": "S0"}}))
(d / "insights.json").write_text(json.dumps({"kind": "meeting", "summary": "s", "topics": [], "bin": 30, "heat": [{"t": 0, "score": 1, "switches": 0, "overlap": 0}],
                                              "highlights": [], "action_items": [{"t": 3, "text": "do it", "speaker": "S1"}]}))

# 1. overlay never touches the original file and is applied on read
out = edits.apply(json.loads((d / "spk.json").read_text()), d / "spk.json")
assert out["segments"][0]["text"] == "hello result" and out["segments"][1]["spk"] == "S0", out
assert {t["spk"] for t in out["turns"]} == {"S0"}, "merge must also remap turns"
assert edits.apply_insights({"action_items": [{"speaker": "S1"}]}, d / "spk.json")["action_items"][0]["speaker"] == "S0"
assert json.loads((d / "spk.json").read_text())["segments"][0]["text"] == "hello resort", "original must stay untouched"
print("ok  edits overlay")

# 2. MCP server: tools exist, names + edits are applied
async def main() -> None:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    p = StdioServerParameters(command=sys.executable, args=[str(ROOT / "mcp_server.py")], env={**os.environ, "MEETING_NOTES_DIR": str(tmp)})
    async with stdio_client(p) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            names = {t.name for t in (await s.list_tools()).tools}
            assert names == {"list_meetings", "get_meeting", "get_transcript", "search", "list_action_items", "get_hotspots"}, names
            tr = (await s.call_tool("get_transcript", {"meeting_id": "m1"})).content[0].text
            assert "[00:00] Alice: hello result" in tr and "[00:03] Alice: next line" in tr, tr
            hit = (await s.call_tool("search", {"query": "result"})).content[0].text
            assert "m1" in hit, hit
            ai = (await s.call_tool("list_action_items", {})).content[0].text
            assert "Alice" in ai and "do it" in ai and "S1" not in ai, ai   # S1 was merged into S0 (Alice)
            gm = json.loads((await s.call_tool("get_meeting", {"meeting_id": "m1"})).content[0].text)
            assert gm["speakers"] == {"S0": "Alice"}, gm["speakers"]
    print("ok  MCP server (6 tools, names + edits applied)")

asyncio.run(main())
