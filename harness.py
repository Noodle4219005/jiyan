"""Pluggable LLM harness: prompt on stdin -> text on stdout. Config via MEETING_HARNESS (JSON)."""
import json, os, re, shlex, subprocess, sys, tempfile, time

PRESETS = ("claude", "codex", "pi", "custom")
# Lean claude call: no tools/slash commands/MCP, no user settings (hooks, CLAUDE.md) -> ~0.6k instead of ~33k tokens of overhead per call.
SYS = "You are a precise assistant inside a notes app. Follow the user's instructions exactly and answer concisely."


def estimate_tokens(text: str) -> int:
    cjk = len(re.findall(r"[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]", text))
    return cjk + (len(text) - cjk + 3) // 4


def log_usage(harness: str, model: str, ms: int, *, inp=0, out=0, cache_read=0, cache_write=0, cost=None, est=False) -> None:
    path = os.environ.get("JIYAN_USAGE_LOG")
    if not path:
        return
    rec = {"ts": int(time.time()), "rec": os.environ.get("JIYAN_REC", ""), "purpose": os.environ.get("JIYAN_PURPOSE", "other"),
           "harness": harness, "model": model, "in": inp, "out": out, "cache_read": cache_read, "cache_write": cache_write,
           "cost": cost, "est": est, "ms": ms}
    with open(path, "a") as f:
        f.write(json.dumps(rec) + "\n")


def run(prompt: str, cfg: dict | None = None, timeout: int = 900, cwd: str | None = None, read_files: bool = False) -> str:
    cfg = cfg or json.loads(os.environ.get("MEETING_HARNESS") or "{}")
    kind = cfg.get("harness", "claude")
    model = (cfg.get("model") or "").strip()
    extra = shlex.split(cfg.get("extra") or "")
    tmp = None
    if kind == "claude":
        cmd = ["claude", "-p", "--output-format", "json", "--strict-mcp-config", "--disable-slash-commands",
               "--setting-sources", "", "--system-prompt", SYS] + (["--model", model] if model else []) + extra
        if read_files:  # let the agent open the transcript files in cwd, nothing else
            cmd += ["--tools", "Read,Grep,Glob", "--allowedTools", "Read", "Grep", "Glob"]
        else:
            cmd += ["--tools", ""]
    elif kind == "codex":
        tmp = tempfile.NamedTemporaryFile(suffix=".txt", delete=False).name
        cmd = ["codex", "exec", "--skip-git-repo-check", "--sandbox", "read-only", "--json", "-o", tmp] \
            + (["-m", model] if model else []) + extra + ["-"]
    elif kind == "pi":
        cmd = ["pi", "-p"] + (["--model", model] if model else []) + extra
    elif kind == "custom":
        cmd = [a.replace("{model}", model) for a in shlex.split(cfg.get("custom") or "")]
        if not cmd:
            raise SystemExit("custom harness: empty command")
    else:
        raise SystemExit(f"unknown harness {kind!r}")
    t0 = time.time()
    r = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    ms = int((time.time() - t0) * 1000)
    try:
        if r.returncode != 0:
            raise SystemExit(f"{kind} exit {r.returncode}: {(r.stderr or r.stdout)[-800:]}")
        if kind == "claude":
            d = json.loads(r.stdout)
            if d.get("is_error"):
                raise SystemExit(f"claude error: {str(d.get('result'))[:800]}")
            u = d.get("usage", {})
            log_usage("claude", model or "default", ms, inp=u.get("input_tokens", 0), out=u.get("output_tokens", 0),
                      cache_read=u.get("cache_read_input_tokens", 0), cache_write=u.get("cache_creation_input_tokens", 0), cost=d.get("total_cost_usd"))
            return d.get("result", "")
        out = open(tmp).read() if tmp else r.stdout
        if kind == "codex":  # --json prints events; the last turn.completed carries the usage
            u = {}
            for line in r.stdout.splitlines():
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if e.get("type") == "turn.completed":
                    u = e.get("usage", u)
            log_usage("codex", model or "default", ms, inp=u.get("input_tokens", 0), out=u.get("output_tokens", 0),
                      cache_read=u.get("cached_input_tokens", 0), cache_write=u.get("cache_write_input_tokens", 0))
        else:  # pi / custom report nothing parseable: estimate from text and mark it
            log_usage(kind, model or "default", ms, inp=estimate_tokens(prompt), out=estimate_tokens(out), est=True)
        return out
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
