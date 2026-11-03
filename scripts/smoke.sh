#!/usr/bin/env bash
# Fast checks (no models, no network, ~10 s). Optional end-to-end on a real file: scripts/smoke.sh --e2e <audio-or-video>
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== TypeScript";  (cd app && npx tsc --noEmit -p tsconfig.json) && echo "ok  typecheck"
echo "== Python syntax"; uv run python -m py_compile analyze.py diarize.py edits.py harness.py mcp_server.py name_speakers.py transcribe.py translate.py && echo "ok  py_compile"
echo "== Overlay + MCP"; uv run python tests/smoke_mcp.py
if [[ "${1:-}" == "--e2e" ]]; then
  f="${2:?usage: smoke.sh --e2e <file>}"; t="$(mktemp -d)"
  echo "== End-to-end (first 60 s of $f)"
  uv run python transcribe.py "$f" "$t/transcript.json" 0 60 | tail -1
  uv run python diarize.py "$t/transcript.json" "$t/spk.json" 0 60 | tail -1
  python3 - "$t/spk.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert d["segments"] and all("spk" in s for s in d["segments"]), "no segments / speakers"
print("ok  e2e:", len(d["segments"]), "segments,", len({s["spk"] for s in d["segments"]}), "speaker(s)")
PY
fi
echo "ALL CHECKS PASSED"
