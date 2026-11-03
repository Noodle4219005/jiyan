import type React from 'react'
import { ArrowRight, Check, ChevronLeft, ChevronRight, Pencil, Plus, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { H3, rowCls, SpkLine, Time } from './Parts'
import { TYPE_LABEL, mmss } from './Timeline'
import type { Insights, Seg, Suggestion } from './types'

/** Show what changed: common prefix/suffix stay plain, the differing middle is struck out and replaced. */
function Diff({ a, b }: { a: string; b: string }): React.JSX.Element {
  // longest-common-subsequence over whole words (Latin) / single characters (CJK), so several separate fixes in one line show separately
  const tok = (t: string): string[] => t.match(/[A-Za-z0-9_']+|\s+|[^\sA-Za-z0-9_']/gu) ?? []
  const x = tok(a), y = tok(b)
  const n = x.length, m = y.length
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const parts: { k: 'eq' | 'del' | 'ins'; t: string }[] = []
  const push = (k: 'eq' | 'del' | 'ins', t: string): void => { const l = parts[parts.length - 1]; if (l && l.k === k) l.t += t; else parts.push({ k, t }) }
  let i = 0, j = 0
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { push('eq', x[i]); i++; j++ }
    else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) { push('ins', y[j]); j++ }
    else { push('del', x[i]); i++ }
  }
  return (
    <span>
      {parts.map((q, k) => q.k === 'eq' ? <span key={k}>{q.t}</span>
        : q.k === 'del' ? <del key={k} className="rounded bg-err px-0.5 text-err-fg">{q.t}</del>
        : <ins key={k} className="rounded bg-ok px-0.5 text-ok-fg no-underline">{q.t}</ins>)}
    </span>
  )
}

function AiPanel(p: {
  suggestions: Suggestion[]; terms: string; busy: boolean; pct?: number | null; segs: Seg[]; seek: (t: number) => void
  onCancel: () => void
  onRun: (terms: string) => void; onResolve: (accept: { i: number; text: string }[], dismiss: number[]) => Promise<void>
}): React.JSX.Element {
  const [terms, setTerms] = useState(p.terms)
  const [shown, setShown] = useState(30)
  const list = p.suggestions
  return (
    <div className="mb-4 rounded-xl border border-line bg-panel2 p-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="size-4 text-link" />AI proofread</div>
      <p className="mt-0.5 text-xs text-muted">The AI looks for mis-heard words and broken terms and proposes fixes. Nothing changes until you accept it. A long recording takes a few minutes.</p>
      <div className="mt-2 flex items-center gap-2">
        <input className={input} value={terms} onChange={(e) => setTerms(e.target.value)}
          placeholder="Names, products and jargon to spell correctly — e.g. QPU, Ising, Pika (optional)" />
        {p.busy
          ? <button className="btn flex-none" onClick={p.onCancel} title="Stop the AI proofread; nothing is changed"><X className="size-3.5" />Cancel{p.pct != null ? ` (${Math.round(p.pct * 100)}%)` : ''}</button>
          : <button className="btn btn-primary flex-none" onClick={() => p.onRun(terms)}>{list.length ? 'Run again' : 'Run'}</button>}
      </div>
      {list.length > 0 && (
        <>
          <div className="mt-3 flex items-center gap-2 text-xs">
            <b>{list.length} suggestion(s)</b>
            <button className="btn px-2 py-1 text-xs" onClick={() => void p.onResolve(list.map((x) => ({ i: x.i, text: x.to })), [])}>Accept all</button>
            <button className="btn px-2 py-1 text-xs" onClick={() => void p.onResolve([], list.map((x) => x.i))}>Dismiss all</button>
          </div>
          <div className="mt-2 max-h-[46vh] space-y-1.5 overflow-auto pr-1">
            {list.slice(0, shown).map((x) => (
              <div key={x.i} className="rounded-lg border border-line bg-bg p-2 text-sm">
                <div className="flex items-start gap-2">
                  <button className="flex-none font-mono text-xs text-muted hover:text-fg" title="Jump here" onClick={() => p.seek(p.segs[x.i]?.start ?? 0)}>{mmss(p.segs[x.i]?.start ?? 0)}</button>
                  <div className="min-w-0 flex-1 leading-relaxed"><Diff a={x.from} b={x.to} />{x.why && <span className="ml-2 text-[11px] text-muted">{x.why}</span>}</div>
                  <button className="btn flex-none px-2 py-0.5 text-xs" title="Accept" onClick={() => void p.onResolve([{ i: x.i, text: x.to }], [])}><Check className="size-3.5" /></button>
                  <button className="btn flex-none px-2 py-0.5 text-xs" title="Dismiss" onClick={() => void p.onResolve([], [x.i])}><X className="size-3.5" /></button>
                </div>
              </div>
            ))}
            {list.length > shown && <button className="btn w-full text-xs" onClick={() => setShown(shown + 30)}>Show {Math.min(30, list.length - shown)} more</button>}
          </div>
        </>
      )}
    </div>
  )
}

const input = 'w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent'

/** Transcript tab: read view (grouped by speaker) or edit view (fix wording / speaker, find & replace). */
export function TranscriptPane(p: {
  id: string; segs: Seg[]; names: Record<string, string>; speakers: string[]; now: number
  q: string; setQ: (v: string) => void; seek: (t: number) => void
  onEdit: (idx: number, patch: { text?: string; spk?: string } | null) => Promise<void>
  onReplaceAll: (find: string, repl: string) => Promise<number>
  onEditMany: (idxs: number[], patch: { spk: string }) => Promise<void>
  suggestions: Suggestion[]; terms: string; aiBusy: boolean; aiPct?: number | null; onAiCancel: () => void
  onAiRun: (terms: string) => void
  onResolve: (accept: { i: number; text: string }[], dismiss: number[]) => Promise<void>
}): React.JSX.Element {
  const [edit, setEdit] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [find, setFind] = useState('')
  const [repl, setRepl] = useState('')
  const [note, setNote] = useState('')
  const [from, setFrom] = useState<number | null>(null)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [last, setLast] = useState<number | null>(null) // row position of the last ticked box, for shift-click ranges
  const [target, setTarget] = useState('')
  const matches = p.segs.map((s, i) => ({ s, i })).filter(({ s }) => !p.q || s.text.includes(p.q))
  const active = p.segs.findIndex((s) => p.now >= s.start && p.now < s.end)
  // edit view renders real text boxes, so show one page of 40 lines at a time (starts near the playhead)
  const PAGE = 40
  const start = from ?? Math.max(0, matches.findIndex((m) => m.i >= Math.max(active, 0)) - 3)
  const rows = edit ? matches.slice(Math.max(0, start), Math.max(0, start) + PAGE) : matches
  const nm = (s?: string): string => (s && p.names[s]) || s || '?'
  const nEdited = p.segs.filter((s) => s.edited).length

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <input className={input} placeholder="Search the transcript…" value={p.q} onChange={(e) => p.setQ(e.target.value)} />
        <button className={`btn flex-none ${aiOpen || p.suggestions.length ? 'border-accent' : ''}`} onClick={() => setAiOpen(!aiOpen)}><Sparkles className="size-3.5" />AI proofread{p.suggestions.length ? ` (${p.suggestions.length})` : ''}</button>
        <button className={`btn flex-none ${edit ? 'btn-primary' : ''}`} onClick={() => setEdit(!edit)}>{edit ? 'Done' : <><Pencil className="size-3.5" />Proofread</>}</button>
      </div>
      {(aiOpen || p.suggestions.length > 0) && (
        <AiPanel suggestions={p.suggestions} terms={p.terms} busy={p.aiBusy} pct={p.aiPct} onCancel={p.onAiCancel} segs={p.segs} seek={p.seek} onRun={p.onAiRun} onResolve={p.onResolve} />
      )}
      {edit && (
        <div className="mb-3 rounded-lg border border-line bg-bg p-3 text-xs text-muted">
          <p>Fix mis-heard words and wrong speakers. Your edits are saved instantly; the original transcript is kept and can be restored per line{nEdited ? ` (${nEdited} edited so far)` : ''}.</p>
          <div className="mt-2 flex items-center gap-2">
            <input className={input} placeholder="Find (e.g. resort)" value={find} onChange={(e) => setFind(e.target.value)} />
            <ArrowRight className="size-3.5 flex-none text-muted" />
            <input className={input} placeholder="Replace with (e.g. result)" value={repl} onChange={(e) => setRepl(e.target.value)} />
            <button className="btn flex-none" disabled={!find} onClick={async () => { const n = await p.onReplaceAll(find, repl); setNote(`Replaced ${n} occurrence(s).`) }}>Replace all</button>
          </div>
          {note && <p className="mt-1.5">{note}</p>}
        </div>
      )}
      {edit && matches.length > PAGE && (
        <div className="mb-3 flex items-center gap-2 text-xs text-muted">
          <button className="btn px-2 py-1 text-xs" disabled={start <= 0} onClick={() => setFrom(Math.max(0, start - PAGE))}><ChevronLeft className="size-3.5" />Earlier</button>
          <span>Lines {Math.max(0, start) + 1}–{Math.min(matches.length, Math.max(0, start) + PAGE)} of {matches.length}</span>
          <button className="btn px-2 py-1 text-xs" disabled={start + PAGE >= matches.length} onClick={() => setFrom(start + PAGE)}>Later<ChevronRight className="size-3.5" /></button>
          <button className="btn px-2 py-1 text-xs" onClick={() => setFrom(null)}>Go to playhead</button>
        </div>
      )}
      {edit && sel.size > 0 && (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/50 bg-panel2 px-3 py-2 text-xs">
          <span>{sel.size} line(s) selected — these were said by</span>
          <select value={target || p.speakers[0]} onChange={(e) => setTarget(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1 text-xs outline-none">
            {p.speakers.map((sp) => <option key={sp} value={sp}>{nm(sp)}</option>)}
          </select>
          <button className="btn btn-primary px-2 py-1 text-xs" onClick={async () => { await p.onEditMany([...sel], { spk: target || p.speakers[0] }); setSel(new Set()) }}>Assign</button>
          <button className="btn px-2 py-1 text-xs" onClick={() => setSel(new Set())}>Clear</button>
          <span className="text-muted">Tip: shift-click a second box to select everything in between.</span>
        </div>
      )}
      {rows.map(({ s, i }, k) => (
        <div key={i}>
          {!edit && (k === 0 || rows[k - 1].s.spk !== s.spk) && <div className="mt-3 px-2.5 first:mt-0"><SpkLine s={s.spk} names={p.names} /></div>}
          {!edit ? (
            <div className={`${rowCls} grid grid-cols-[3.25rem_1fr] items-baseline ${active === i ? 'bg-sel' : ''}`} onClick={() => p.seek(s.start)}>
              <Time t={s.start} /><span>{s.text}{s.edited && <span className="ml-1.5 text-[10px] text-warnc" title="Edited"><Pencil className="inline size-3" /></span>}</span>
            </div>
          ) : (
            <div className={`mb-2 rounded-lg border p-2 ${s.edited ? 'border-warnc/40' : 'border-line'}`}>
              <div className="mb-1 flex items-center gap-2">
                <input type="checkbox" checked={sel.has(i)} title="Select (shift-click for a range)" className="size-3.5 accent-blue-500"
                  onChange={() => { /* handled in onClick so shiftKey is available */ }}
                  onClick={(e) => {
                    const next = new Set(sel)
                    if (e.shiftKey && last !== null) {
                      const [lo, hi] = [Math.min(last, k), Math.max(last, k)]
                      for (let z = lo; z <= hi; z++) next.add(rows[z].i)
                    } else if (next.has(i)) next.delete(i); else next.add(i)
                    setSel(next); setLast(k)
                  }} />
                <button className="font-mono text-xs text-muted hover:text-fg" title="Jump here" onClick={() => p.seek(s.start)}>{mmss(s.start)}</button>
                <select value={s.spk ?? ''} onChange={(e) => void p.onEdit(i, { spk: e.target.value })}
                  className="rounded-md border border-line bg-bg px-2 py-0.5 text-xs outline-none">
                  {p.speakers.map((sp) => <option key={sp} value={sp}>{nm(sp)}</option>)}
                </select>
                {s.edited && <button className="ml-auto text-xs text-warnc hover:underline" onClick={() => void p.onEdit(i, null)}>Restore original</button>}
              </div>
              <textarea key={s.text} defaultValue={s.text} rows={1} className={`${input} field-sizing-content resize-none`}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.text) void p.onEdit(i, { text: v }) }} />
              {s.edited && s.orig !== undefined && s.orig !== s.text && <p className="mt-1 text-[11px] text-muted">Original: {s.orig}</p>}
            </div>
          )}
        </div>
      ))}
    </>
  )
}

/** Editor for the AI-written notes (title, summary, topics, highlights, action items, concepts). */
export function NotesEditor(p: {
  draft: Insights; setDraft: (d: Insights) => void; now: number; speakers: string[]; names: Record<string, string>
}): React.JSX.Element {
  const d = p.draft
  const set = (patch: Partial<Insights>): void => p.setDraft({ ...d, ...patch })
  const nm = (s?: string): string => (s && p.names[s]) || s || '?'
  const upd = <T,>(arr: T[] | undefined, i: number, patch: Partial<T>): T[] => (arr ?? []).map((x, k) => (k === i ? { ...x, ...patch } : x))
  const del = <T,>(arr: T[] | undefined, i: number): T[] => (arr ?? []).filter((_, k) => k !== i)
  const t0 = Math.round(p.now)
  const types = Object.keys(TYPE_LABEL)
  const DelBtn = ({ onClick }: { onClick: () => void }): React.JSX.Element => <button className="btn flex-none px-2 py-1 text-xs" title="Delete" onClick={onClick}><X className="size-3.5" /></button>
  const spkSel = (v: string | undefined, on: (s: string) => void): React.JSX.Element => (
    <select value={v ?? ''} onChange={(e) => on(e.target.value)} className="w-28 flex-none rounded-md border border-line bg-bg px-2 py-1.5 text-xs outline-none">
      <option value="">—</option>{p.speakers.map((s) => <option key={s} value={s}>{nm(s)}</option>)}
    </select>
  )
  return (
    <div className="max-w-3xl space-y-2">
      <input className={`${input} text-base font-semibold`} value={d.title ?? ''} placeholder="Title" onChange={(e) => set({ title: e.target.value })} />
      <textarea className={`${input} field-sizing-content min-h-24 leading-relaxed`} value={d.summary ?? ''} placeholder="Summary" onChange={(e) => set({ summary: e.target.value })} />

      <H3>Topics</H3>
      {(d.topics ?? []).map((t, i) => (
        <div key={i} className="flex items-center gap-2"><Time t={t.t} /><input className={input} value={t.title} onChange={(e) => set({ topics: upd(d.topics, i, { title: e.target.value }) })} /><DelBtn onClick={() => set({ topics: del(d.topics, i) })} /></div>
      ))}
      <button className="btn text-xs" onClick={() => set({ topics: [...(d.topics ?? []), { t: t0, title: '' }].sort((a, b) => a.t - b.t) })}><Plus className="size-3.5" />Add topic at {mmss(t0)}</button>

      <H3>Highlights</H3>
      {(d.highlights ?? []).map((h, i) => (
        <div key={i} className="flex items-center gap-2">
          <Time t={h.t} />
          <select value={h.type} onChange={(e) => set({ highlights: upd(d.highlights, i, { type: e.target.value }) })} className="w-28 flex-none rounded-md border border-line bg-bg px-2 py-1.5 text-xs outline-none">
            {types.map((k) => <option key={k} value={k}>{TYPE_LABEL[k]}</option>)}
          </select>
          <input className={input} value={h.title} onChange={(e) => set({ highlights: upd(d.highlights, i, { title: e.target.value }) })} />
          {spkSel(h.speaker, (s) => set({ highlights: upd(d.highlights, i, { speaker: s || undefined }) }))}
          <DelBtn onClick={() => set({ highlights: del(d.highlights, i) })} />
        </div>
      ))}
      <button className="btn text-xs" onClick={() => set({ highlights: [...(d.highlights ?? []), { t: t0, type: 'key_point', title: '' }].sort((a, b) => a.t - b.t) })}><Plus className="size-3.5" />Add highlight at {mmss(t0)}</button>

      <H3>Action items</H3>
      {(d.action_items ?? []).map((a, i) => (
        <div key={i} className="flex items-center gap-2">
          <Time t={a.t} />
          <input className={input} value={a.text} onChange={(e) => set({ action_items: upd(d.action_items, i, { text: e.target.value }) })} />
          {spkSel(a.speaker, (s) => set({ action_items: upd(d.action_items, i, { speaker: s || undefined }) }))}
          <DelBtn onClick={() => set({ action_items: del(d.action_items, i) })} />
        </div>
      ))}
      <button className="btn text-xs" onClick={() => set({ action_items: [...(d.action_items ?? []), { t: t0, text: '' }].sort((a, b) => a.t - b.t) })}><Plus className="size-3.5" />Add action item at {mmss(t0)}</button>

      {!!d.concepts?.length && (<>
        <H3>Key concepts</H3>
        {d.concepts.map((c, i) => (
          <div key={i} className="flex items-start gap-2">
            <Time t={c.t} />
            <input className={`${input} w-40 flex-none`} value={c.term} onChange={(e) => set({ concepts: upd(d.concepts, i, { term: e.target.value }) })} />
            <textarea className={`${input} field-sizing-content resize-none`} value={c.definition} onChange={(e) => set({ concepts: upd(d.concepts, i, { definition: e.target.value }) })} />
            <DelBtn onClick={() => set({ concepts: del(d.concepts, i) })} />
          </div>
        ))}
      </>)}
    </div>
  )
}
