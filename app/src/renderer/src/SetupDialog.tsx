import type React from 'react'
import { Check } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Steps } from './Parts'
import type { SetupEvent, SetupStatus } from './types'

const Row = ({ ok, title, children }: { ok: boolean; title: string; children?: React.ReactNode }): React.JSX.Element => (
  <div className="flex gap-3 py-2">
    <span className={`mt-0.5 grid size-5 flex-none place-items-center rounded-full text-xs ${ok ? 'bg-ok text-okc' : 'bg-warn text-warnc'}`}>{ok ? <Check className="size-3" /> : <span className="font-bold">!</span>}</span>
    <div className="min-w-0 flex-1 text-sm"><div className="font-medium">{title}</div>{children && <div className="mt-0.5 text-xs text-muted">{children}</div>}</div>
  </div>
)
const Cmd = ({ c }: { c: string }): React.JSX.Element => (
  <code className="mt-1 flex items-center gap-2 rounded-md border border-line bg-bg px-2 py-1 text-[11px] text-fg2">
    <span className="min-w-0 flex-1 select-all break-all">{c}</span>
    <button className="flex-none text-link hover:underline" onClick={() => void navigator.clipboard.writeText(c)}>Copy</button>
  </code>
)

export const setupReady = (s: SetupStatus): boolean => !!s.uv && !!s.ffmpeg && s.venv && s.speakerModels && s.whisper

export default function SetupDialog(p: { onClose: () => void }): React.JSX.Element {
  const [st, setSt] = useState<SetupStatus | null>(null)
  const [run, setRun] = useState<SetupEvent | null>(null)
  const [tick, setTick] = useState(Date.now())
  const check = useCallback(async () => setSt(await window.api.setupStatus()), [])
  useEffect(() => { void check() }, [check])
  useEffect(() => window.api.onSetup((e) => { setRun(e); void check() }), [check])
  useEffect(() => { const h = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(h) }, [])
  if (!st) return <div />
  const toolsOk = !!st.uv && !!st.ffmpeg
  const running = run?.status === 'running'
  const anyHarness = st.harness.claude || st.harness.codex || st.harness.pi
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-overlay backdrop-blur-[2px]">
      <div className="max-h-[90vh] w-[560px] overflow-auto rounded-xl border border-line bg-panel p-5 shadow-2xl">
        <h2 className="text-base font-semibold">Set up Jiyan</h2>
        <p className="mt-1 text-xs text-muted">One-time setup. Everything runs on this computer; only the AI summary uses the assistant you choose.</p>

        <div className="mt-3 divide-y divide-line">
          <Row ok={!!st.uv} title="uv (Python manager)">
            {st.uv ? st.uv : <>Not found. Install it with:<Cmd c="curl -LsSf https://astral.sh/uv/install.sh | sh" /></>}
          </Row>
          <Row ok={!!st.ffmpeg} title="ffmpeg (audio and video)">
            {st.ffmpeg ? 'Installed' : <>Not found. Install it with your package manager:<Cmd c="sudo pacman -S ffmpeg" /><Cmd c="sudo apt install ffmpeg" /></>}
          </Row>
          <Row ok={st.venv} title="Python environment">{st.venv ? 'Ready' : 'Will be installed (~500 MB)'}</Row>
          <Row ok={st.speakerModels} title="Speaker models">{st.speakerModels ? 'Ready' : 'Will be downloaded (~45 MB)'}</Row>
          <Row ok={st.whisper} title="Speech recognition model">{st.whisper ? 'Ready' : 'Will be downloaded (~1.6 GB)'}</Row>
          <Row ok={anyHarness} title="AI assistant for summaries and chat">
            {anyHarness
              ? `Found: ${(['claude', 'codex', 'pi'] as const).filter((k) => st.harness[k]).join(', ')}. Choose which one to use in Settings.`
              : 'None of Claude Code, Codex or pi was found. Install one and sign in, then pick it in Settings. Transcripts and subtitles work without it.'}
          </Row>
        </div>

        {run && <div className="mt-3"><Steps steps={run.steps} now={tick} pct={null} /></div>}
        {run?.status === 'error' && <div className="mt-3 whitespace-pre-wrap rounded-lg bg-err px-3 py-2 text-xs text-err-fg">{run.message}</div>}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="btn" onClick={() => void check()} disabled={running}>Re-check</button>
          {!setupReady(st) && (
            <button className="btn btn-primary" disabled={!toolsOk || running} title={toolsOk ? '' : 'Install uv and ffmpeg first'}
              onClick={() => { setRun(null); void window.api.setupRun() }}>
              {running ? 'Installing…' : 'Install everything'}
            </button>
          )}
          <button className={`btn ${setupReady(st) ? 'btn-primary' : ''}`} onClick={p.onClose}>{setupReady(st) ? 'Start' : 'Later'}</button>
        </div>
      </div>
    </div>
  )
}
