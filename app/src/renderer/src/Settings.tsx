import { useEffect, useState } from 'react'
import type React from 'react'
import type { Settings } from './types'

const HINT: Record<Settings['harness'], string> = {
  claude: 'Runs claude -p (uses your Claude Code login). Model examples: sonnet, opus',
  codex: 'Runs codex exec in a read-only sandbox. Model example: gpt-6-luna',
  pi: 'Runs pi -p. Model example: nvidia/deepseek-ai/deepseek-v4.1-flash; leave empty for the pi default',
  custom: 'Custom command: prompt is sent on stdin, the result is read from stdout; {model} is substituted'
}

export default function SettingsDialog(p: { onClose: () => void; onFolderChanged: () => void; onOpenSetup: () => void }): React.JSX.Element {
  const [s, setS] = useState<Settings | null>(null)
  const [res, setRes] = useState<{ ok: boolean; ms: number; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [dataDir, setDataDir] = useState('')
  const [root, setRoot] = useState('')
  useEffect(() => { void window.api.getSettings().then(setS); void window.api.getConfig().then((c) => { setDataDir(c.dataDir); setRoot(c.root) }) }, [])
  if (!s) return <div />
  const set = (k: keyof Settings, v: string): void => { setS({ ...s, [k]: v } as Settings); setRes(null) }
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/60 backdrop-blur-sm" onClick={p.onClose}>
      <div className="flex w-[480px] flex-col gap-3 rounded-xl border border-line bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Project folder</h3>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-bg px-3 py-1.5 text-xs text-slate-300" title={dataDir}>{dataDir}</code>
          <button className="btn" onClick={async () => { const d = await window.api.chooseDir(); if (d) { setDataDir(d); p.onFolderChanged() } }}>Change…</button>
        </div>
        <h3 className="mt-2 text-base font-semibold">AI analysis harness</h3>
        <label className="flex flex-col gap-1 text-xs text-muted">Harness
          <select className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-accent" value={s.harness} onChange={(e) => set('harness', e.target.value)}>
            <option value="claude">Claude Code</option><option value="codex">Codex</option>
            <option value="pi">pi</option><option value="custom">Custom command</option>
          </select>
        </label>
        <div className="text-xs text-muted">{HINT[s.harness]}</div>
        {s.harness !== 'custom' && (<>
          <label className="flex flex-col gap-1 text-xs text-muted">Model (optional)<input className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-accent" value={s.model} onChange={(e) => set('model', e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Extra arguments<input className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-accent" placeholder="e.g. --thinking low" value={s.extra} onChange={(e) => set('extra', e.target.value)} /></label>
        </>)}
        {s.harness === 'custom' && (<>
          <label className="flex flex-col gap-1 text-xs text-muted">Command<input className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-accent" placeholder="e.g. my-llm --model {model}" value={s.custom} onChange={(e) => set('custom', e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Model (replaces {'{model}'})<input className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-accent" value={s.model} onChange={(e) => set('model', e.target.value)} /></label>
        </>)}
        <label className="flex flex-col gap-1 text-xs text-muted">Output language of AI summary
          <select className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-accent" value={s.lang} onChange={(e) => set('lang', e.target.value)}>
            <option value="auto">Same as the recording</option><option value="en">English</option><option value="zh-TW">Traditional Chinese</option>
          </select>
        </label>
        {res && <div className={`whitespace-pre-wrap rounded-md px-3 py-2 text-xs ${res.ok ? 'bg-emerald-900/40 text-emerald-200' : 'bg-red-900/40 text-red-200'}`}>{res.ok ? 'Works' : 'Failed'}（{(res.ms / 1000).toFixed(1)} s) ：{res.text}</div>}
        <div className="mt-1 border-t border-line pt-3">
          <h3 className="text-base font-semibold">Use from Claude Code / Codex</h3>
          <p className="mt-0.5 text-xs text-muted">Run one of these once in a terminal so the agent can search and read your recordings.</p>
          {[['Claude Code', 'claude'], ['Codex', 'codex']].map(([label, bin]) => {
            const c = `${bin} mcp add jiyan -- uv run --project ${root} python ${root}/mcp_server.py`
            return (
              <div key={bin} className="mt-2">
                <div className="text-xs text-muted">{label}</div>
                <code className="mt-1 flex items-center gap-2 rounded-md border border-line bg-bg px-2 py-1 text-[11px] text-slate-300">
                  <span className="min-w-0 flex-1 select-all break-all">{c}</span>
                  <button className="flex-none text-accent hover:underline" onClick={() => void navigator.clipboard.writeText(c)}>Copy</button>
                </code>
              </div>
            )
          })}
          <button className="btn mt-3 text-xs" onClick={p.onOpenSetup}>Check installation…</button>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn" disabled={busy} onClick={async () => { setBusy(true); setRes(await window.api.testSettings(s)); setBusy(false) }}>
            {busy ? 'Testing…' : 'Test connection'}
          </button>
          <button className="btn btn-primary" onClick={async () => { await window.api.setSettings(s); p.onClose() }}>Save</button>
          <button className="btn" onClick={p.onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
