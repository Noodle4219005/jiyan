"""Pluggable LLM harness: prompt on stdin -> text on stdout. Config via MEETING_HARNESS (JSON)."""
import json, os, shlex, subprocess, sys, tempfile

PRESETS = ("claude", "codex", "pi", "custom")


def run(prompt: str, cfg: dict | None = None, timeout: int = 900, cwd: str | None = None, read_files: bool = False) -> str:
    cfg = cfg or json.loads(os.environ.get("MEETING_HARNESS") or "{}")
    kind = cfg.get("harness", "claude")
    model = (cfg.get("model") or "").strip()
    extra = shlex.split(cfg.get("extra") or "")
    tmp = None
    if kind == "claude":
        cmd = ["claude", "-p", "--output-format", "text"] + (["--model", model] if model else []) + extra
        if read_files:  # let the agent open the transcript files in cwd, nothing else
            cmd += ["--allowedTools", "Read", "Grep", "Glob"]
    elif kind == "codex":
        tmp = tempfile.NamedTemporaryFile(suffix=".txt", delete=False).name
        cmd = ["codex", "exec", "--skip-git-repo-check", "--sandbox", "read-only", "-o", tmp] \
            + (["-m", model] if model else []) + extra + ["-"]
    elif kind == "pi":
        cmd = ["pi", "-p"] + (["--model", model] if model else []) + extra
    elif kind == "custom":
        cmd = [a.replace("{model}", model) for a in shlex.split(cfg.get("custom") or "")]
        if not cmd:
            raise SystemExit("custom harness: empty command")
    else:
        raise SystemExit(f"unknown harness {kind!r}")
    r = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    try:
        if r.returncode != 0:
            raise SystemExit(f"{kind} exit {r.returncode}: {(r.stderr or r.stdout)[-800:]}")
        return open(tmp).read() if tmp else r.stdout
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)


if __name__ == "__main__":
    # self-test:  python harness.py "<prompt>"
    # agent chat: python harness.py --chat <dir>   (prompt on stdin; the agent may read files under <dir>)
    if len(sys.argv) > 2 and sys.argv[1] == "--chat":
        print(run(sys.stdin.read(), cwd=sys.argv[2], read_files=True))
    else:
        print(run(sys.argv[1] if len(sys.argv) > 1 else "只回答 OK"))
