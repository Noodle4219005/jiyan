import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ChatMsg } from './types'

const SUGGEST_THIS = ['Summarize the key decisions', 'List action items per person', 'What was left unresolved?']
const SUGGEST_ALL = ['What did we decide across all recordings?', 'Which recordings mention deadlines?', 'List every open question']
const TS = /(\[(?:\d{1,2}:)?\d{2}:\d{2}\])/
const IS_TS = /^\[(?:\d{1,2}:)?\d{2}:\d{2}\]$/

/** Render text, turning [mm:ss] citations into buttons that seek the player. */
function Rich({ text, onSeek }: { text: string; onSeek?: (t: number) => void }): React.JSX.Element {
  return (
    <>
      {text.replace(/\*\*/g, '').split(TS).map((part, i) => {
        if (!IS_TS.test(part) || !onSeek) return <span key={i}>{part}</span>
        const n = part.slice(1, -1).split(':').map(Number)
        const sec = n.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n[0] * 60 + n[1]
        return <button key={i} onClick={() => onSeek(sec)} className="mx-0.5 rounded bg-accent/20 px-1 font-mono text-xs text-blue-200 hover:bg-accent/40">{part.slice(1, -1)}</button>
      })}
    </>
  )
}

/** Floating chat: a round button bottom-right that opens a popover, available on every screen. */
export default function Chat(p: { id: string | null; title: string; ready: boolean; getNow: () => number; onSeek?: (t: number) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [scopePref, setScopePref] = useState<'this' | 'all'>('this')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const scope: 'this' | 'all' = p.id ? scopePref : 'all'
  const canAsk = scope === 'all' || p.ready

  useEffect(() => { setErr(''); setMsgs([]); void window.api.chatLoad(p.id, scope).then(setMsgs) }, [p.id, scope])
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy, open])
  useEffect(() => {
    const h = (e: KeyboardEvent): void => { if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); setOpen((o) => !o) } if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])

  const send = async (text: string): Promise<void> => {
    const msg = text.trim()
    if (!msg || busy || !canAsk) return
    const sentFor = p.id, sentScope = scope
    setInput(''); setErr(''); setBusy(true)
    setMsgs((m) => [...m, { role: 'user', text: msg, at: Date.now() }])
    const r = await window.api.chatSend(sentFor, sentScope, msg, scope === 'this' ? p.getNow() : undefined)
    setBusy(false)
    if (sentFor !== p.id || sentScope !== scope) return // user switched context while waiting
    if (r.ok) setMsgs(r.messages); else setErr(r.error)
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-6 z-30 flex h-[min(620px,calc(100vh-8rem))] w-[400px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-black/50">
          <div className="flex items-center gap-2 border-b border-line p-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Ask the AI agent</div>
              <div className="truncate text-xs text-muted">{scope === 'this' ? p.title : 'All recordings'}</div>
            </div>
            {p.id && (
              <select value={scopePref} onChange={(e) => setScopePref(e.target.value as 'this' | 'all')} className="rounded-md border border-line bg-bg px-2 py-1 text-xs outline-none">
                <option value="this">This recording</option><option value="all">All recordings</option>
              </select>
            )}
            <button title="Clear conversation" className="btn px-2 py-1 text-xs" onClick={async () => { await window.api.chatClear(p.id, scope); setMsgs([]) }}>Clear</button>
            <button title="Close (Esc)" className="btn px-2 py-1 text-xs" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
            {msgs.length === 0 && (
              <div className="space-y-2 text-sm text-muted">
                <p>{canAsk ? 'Ask anything. The agent reads the transcripts and answers with timestamps' + (scope === 'this' ? ' you can click to jump.' : '.') : 'Finish transcription first — the agent needs the transcript.'}</p>
                {canAsk && (scope === 'this' ? SUGGEST_THIS : SUGGEST_ALL).map((s) => (
                  <button key={s} onClick={() => void send(s)} className="block w-full rounded-lg border border-line px-3 py-2 text-left text-slate-300 hover:bg-panel2">{s}</button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'ml-8' : 'mr-4'}>
                <div className={`whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-relaxed ${m.role === 'user' ? 'bg-accent text-white' : 'bg-panel2 text-slate-200'}`}>
                  {m.role === 'assistant' ? <Rich text={m.text} onSeek={scope === 'this' ? p.onSeek : undefined} /> : m.text}
                </div>
              </div>
            ))}
            {busy && <div className="mr-4 rounded-xl bg-panel2 px-3 py-2 text-sm text-muted">Reading the transcript…</div>}
            {err && <div className="whitespace-pre-wrap rounded-lg bg-red-900/40 px-3 py-2 text-xs text-red-200">{err}</div>}
            <div ref={end} />
          </div>

          <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send(input) }}>
            <textarea value={input} rows={2} disabled={!canAsk} autoFocus placeholder="Ask…  (Enter to send, Shift+Enter for newline)"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input) } }}
              className="min-w-0 flex-1 resize-none rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50" />
            <button className="btn btn-primary self-end" disabled={busy || !canAsk || !input.trim()}>Send</button>
          </form>
        </div>
      )}
      <button onClick={() => setOpen(!open)} title="Ask the AI agent (Ctrl+/)"
        className={`fixed bottom-6 right-6 z-40 grid size-14 place-items-center rounded-full text-2xl shadow-lg shadow-black/50 transition hover:scale-105 ${open ? 'bg-panel2 text-slate-300' : 'bg-accent text-white'}`}>
        {open ? '✕' : '💬'}
      </button>
    </>
  )
}
