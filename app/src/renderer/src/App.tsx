import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Chat from './Chat'
import CueList from './CueList'
import { NotesEditor, TranscriptPane } from './Proofread'
import { Card, dur, H3, rowCls, SpkLine, Steps, Time } from './Parts'
import SettingsDialog from './Settings'
import SetupDialog, { setupReady } from './SetupDialog'
import UsageDialog, { fmtCost, fmtTok } from './UsageDialog'
import { cueLabel, toCues, toSrt, toVtt, type SubOpts } from './subtitles'
import SubtitlesPanel, { slug } from './SubtitlesPanel'
import Timeline, { KIND_LABEL, TYPE_COLOR, TYPE_LABEL, mediaUrl, mmss, renderTimelinePng, spkColor, thumbUrl } from './Timeline'
import type { Insights, Loaded, Meta, PipelineEvent, UsageSummary } from './types'

const STAGE: Record<string, string> = { new: 'Not processed', transcribed: 'Transcribed', diarized: 'Speakers found', done: 'Ready' }
const TABS = [['summary', 'Summary'], ['transcript', 'Transcript'], ['highlights', 'Highlights & tasks'], ['subtitles', 'Subtitles']] as const
const KINDS = [['meeting', 'Meeting'], ['lecture', 'Lecture / course'], ['recording', 'Other recording']] as const

const Chip = ({ color, children }: { color: string; children: React.ReactNode }): React.JSX.Element => (
  <span className="rounded-full px-2 py-px text-[11px] font-medium text-black" style={{ background: color }}>{children}</span>
)
const Badge = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <span className="rounded border border-line px-1.5 py-px text-[10px] uppercase tracking-wide text-muted">{children}</span>
)

export default function App(): React.JSX.Element {
  const [meetings, setMeetings] = useState<Meta[]>([])
  const [cur, setCur] = useState<Loaded | null>(null)
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('summary')
  const [now, setNow] = useState(0)
  const [progress, setProgress] = useState<Record<string, PipelineEvent>>({})
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [showUsage, setShowUsage] = useState(false)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const refreshUsage = useCallback(async () => setUsage(await window.api.usageSummary()), [])
  const [verr, setVerr] = useState('')
  const [kind, setKind] = useState('meeting')
  const [editing, setEditing] = useState<string | null>(null)
  const [caps, setCaps] = useState(() => localStorage.getItem('caps') !== '0')
  const [capSpk, setCapSpk] = useState(() => localStorage.getItem('capSpk') === '1')
  const [subSel, setSubSel] = useState('orig') // orig | trans:<lang> | both:<lang>
  const [tLang, setTLang] = useState('English')
  const [naming, setNaming] = useState(false)
  const [nameNote, setNameNote] = useState('')
  const [adding, setAdding] = useState<string | null>(null) // name being typed for a new person
  const [mergeFrom, setMergeFrom] = useState<string | null>(null)
  const [mergeInto, setMergeInto] = useState('')
  const [draft, setDraft] = useState<Insights | null>(null) // non-null while editing the AI notes
  const [tick, setTick] = useState(Date.now())
  const [names, setNames] = useState<Record<string, string>>({})
  const video = useRef<HTMLMediaElement>(null)
  const curId = useRef<string | null>(null)
  const busyRef = useRef<Record<string, boolean>>({})
  useEffect(() => { const h = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(h) }, [])

  const refresh = useCallback(async () => setMeetings(await window.api.list()), [])
  const open = useCallback(async (id: string) => {
    curId.current = id
    setVerr(''); setEditing(null); setTypeFilter(null); setNameNote(''); setDraft(null); setMergeFrom(null); setAdding(null)
    const l = await window.api.load(id)
    setCur(l); setNames(l.speakers ?? {}); setNow(0); setSubSel('orig')
    if (l.transcript?.turns?.length && !l.namesChecked && !busyRef.current[id]) void autoNames(id, true)
  }, [])

  useEffect(() => { void refreshUsage(); const h = setInterval(() => void refreshUsage(), 10000); return () => clearInterval(h) }, [refreshUsage])
  useEffect(() => { void window.api.setupStatus().then((s) => { if (!setupReady(s)) setShowSetup(true) }) }, [])
  useEffect(() => {
    void refresh()
    return window.api.onPipeline((e) => {
      busyRef.current[e.id] = e.status === 'running' || e.status === 'paused'
      setProgress((p) => ({ ...p, [e.id]: { ...e, steps: e.steps ?? p[e.id]?.steps, stepPct: e.stepPct === undefined ? p[e.id]?.stepPct : e.stepPct } }))
      if (e.status !== 'running' && e.status !== 'paused') { void refresh(); void refreshUsage() }
      if (e.status === 'done' && curId.current === e.id) {
        const tl = /^Translating subtitles to (.+)$/.exec(e.steps?.[0]?.name ?? '')
        const pr = e.steps?.[0]?.name === 'Proofreading with AI'
        void open(e.id).then(() => { if (tl) { setSubSel(`both:${tl[1]}`); setTab('subtitles') } if (pr) setTab('transcript') })
      }
    })
  }, [refresh, open, refreshUsage])

  const cues = useMemo(() => (cur?.transcript ? toCues(cur.transcript.segments) : []), [cur?.transcript])
  const [mode, lang] = subSel.split(':') as ['orig' | 'trans' | 'both', string | undefined]
  const transRaw = lang ? cur?.translations?.[slug(lang)] : undefined
  const transStale = !!transRaw && transRaw.length !== cues.length // transcript was edited after translating
  const trans = transStale ? undefined : transRaw
  const linesTrans = trans ?? Object.values(cur?.translations ?? {}).find((t) => t.length === cues.length)
  const subOpts = useMemo<SubOpts>(() => ({ names, withSpk: capSpk, mode: trans ? mode : 'orig', trans }), [names, capSpk, mode, trans])
  const vttUrl = useMemo(() => (cues.length ? URL.createObjectURL(new Blob([toVtt(cues, subOpts)], { type: 'text/vtt' })) : ''), [cues, subOpts])
  useEffect(() => () => { if (vttUrl) URL.revokeObjectURL(vttUrl) }, [vttUrl])
  useEffect(() => {
    const tt = video.current?.textTracks
    if (tt?.[0]) tt[0].mode = caps ? 'showing' : 'hidden'
  }, [caps, vttUrl, cur?.playback])
  const flag = (k: string, v: boolean): void => { try { localStorage.setItem(k, v ? '1' : '0') } catch { /* ignore */ } }

  const saveTitle = async (title: string): Promise<void> => {
    setEditing(null)
    if (!cur || !title.trim() || title.trim() === cur.meta.title) return
    const t = await window.api.rename(cur.meta.id, title)
    setCur({ ...cur, meta: { ...cur.meta, title: t } }); void refresh()
  }
  // Runs automatically after processing and when opening an older recording that was never checked; the button re-runs it.
  const autoNames = useCallback(async (id: string, silent: boolean): Promise<void> => {
    setNaming(true); if (!silent) setNameNote('')
    const r = await window.api.suggestNames(id)
    setNaming(false)
    if (curId.current !== id) return
    if (!r.ok) { if (!silent) setNameNote(`Could not suggest names: ${r.error}`); return }
    setNames(r.speakers)
    const hits = Object.entries(r.names).filter(([s, g]) => g.name && g.confidence !== 'low' && r.speakers[s] === g.name)
    const left = Object.keys(r.names).filter((s) => !r.speakers[s]?.trim()).length
    setNameNote(hits.length
      ? `Named from the conversation: ${hits.map(([s, g]) => `${s} → ${g.name}`).join(', ')}.${left ? ` ${left} more had no clear evidence — type those yourself.` : ''}`
      : 'Nobody was named in the conversation, so names stay as labels — type them if you know them.')
  }, [])
  const reload = async (): Promise<void> => {
    if (!cur) return
    const l = await window.api.load(cur.meta.id)
    setCur((c) => (c && c.meta.id === l.meta.id ? { ...c, transcript: l.transcript, translations: l.translations, insights: l.insights, merge: l.merge, extra: l.extra, suggestions: l.suggestions } : c))
    setNames(l.speakers ?? {})
  }
  const editSegment = async (idx: number, patch: { text?: string; spk?: string } | null): Promise<void> => {
    if (!cur) return
    await window.api.editSegment(cur.meta.id, idx, patch)
    await reload()
  }
  const replaceAll = async (find: string, repl: string): Promise<number> => {
    if (!cur) return 0
    const n = await window.api.replaceAll(cur.meta.id, find, repl)
    await reload()
    return n
  }
  const addPerson = async (): Promise<void> => {
    if (!cur || !adding?.trim()) return
    const name = adding.trim()
    await window.api.addSpeaker(cur.meta.id, name)
    setAdding(null); await reload(); setTab('transcript')
    setNameNote(`Added ${name}. Open Transcript → ✎ Proofread, tick the lines ${name} said (shift-click for a range) and press Assign.`)
  }
  const saveDraft = async (): Promise<void> => { if (cur && draft) { await window.api.saveInsights(cur.meta.id, draft); setDraft(null); await reload() } }
  const seek = (t: number): void => { if (video.current) { video.current.currentTime = t; void video.current.play() } }

  // audio-only: no picture, so the subtitle text itself is the "screen"
  const ci = useMemo(() => { let k = -1; for (let i = 0; i < cues.length && cues[i].start <= now; i++) k = i; return k }, [cues, now])
  const stepCue = useCallback((dir: 1 | -1): void => {
    if (!cues.length) return
    const el = video.current
    const t = el?.currentTime ?? 0
    let i = ci
    if (dir === 1) i = Math.min(ci + 1, cues.length - 1)
    else i = t - (cues[ci]?.start ?? 0) > 1.5 ? ci : Math.max(ci - 1, 0) // first press restarts the current line
    if (el && cues[i]) { el.currentTime = cues[i].start; void el.play() }
  }, [cues, ci])
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '[') stepCue(-1)
      if (e.key === ']') stepCue(1)
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [stepCue])
  const tr = cur?.transcript
  const ins = cur?.insights
  const active = tr?.segments.find((s) => now >= s.start && now < s.end)
  const segs = tr?.segments.filter((s) => !q || s.text.includes(q)) ?? []
  const spkTime = (tr?.turns ?? []).reduce<Record<string, number>>((m, t) => ({ ...m, [t.spk]: (m[t.spk] ?? 0) + t.e - t.s }), {})
  for (const x of cur?.extra ?? []) spkTime[x] ??= 0
  const spkStats = Object.entries(spkTime).sort((a, b) => b[1] - a[1])
  const stage = meetings.find((m) => m.id === cur?.meta.id)?.stage ?? 'new'
  const prog = cur ? progress[cur.meta.id] : undefined
  const busyOf = (id: string): boolean => progress[id]?.status === 'running' || progress[id]?.status === 'paused'
  const usedTypes = [...new Set((ins?.highlights ?? []).map((h) => h.type))]
  const kindOf = (m: Meta): string => KIND_LABEL[m.kind ?? 'meeting'] ?? 'Meeting'

  return (
    <div className="grid h-full grid-cols-[264px_1fr]">
      {/* ───────── sidebar ───────── */}
      <aside className="flex min-h-0 flex-col border-r border-line bg-panel">
        <div className="space-y-2 border-b border-line p-3">
          <div className="text-sm font-semibold">Jiyan <span className="font-normal text-muted">記言</span></div>
          <label className="block text-[11px] text-muted">What are you importing?
            <select value={kind} onChange={(e) => setKind(e.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-accent">
              {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <button className="btn btn-primary w-full" onClick={async () => { const id = await window.api.importVideo(kind); await refresh(); if (id) await open(id) }}>
            ＋ Import video or audio
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
          {meetings.length === 0 && <p className="px-2 py-3 text-xs text-muted">No recordings yet.</p>}
          {meetings.map((m) => (
            <div key={m.id} onClick={() => void open(m.id)}
              className={`group cursor-pointer rounded-lg border px-3 py-2 transition ${cur?.meta.id === m.id ? 'border-accent/60 bg-panel2' : 'border-transparent hover:bg-panel2'}`}>
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1 truncate text-sm">{m.title}</div>
                <button title="Delete this recording from the app" className="rounded px-1.5 text-muted opacity-0 transition hover:bg-red-900/50 hover:text-red-200 group-hover:opacity-100"
                  onClick={async (e) => { e.stopPropagation(); if (await window.api.deleteMeeting(m.id)) { if (curId.current === m.id) { setCur(null); curId.current = null } void refresh() } }}>✕</button>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs">
                <Badge>{kindOf(m)}</Badge>
                <span className={busyOf(m.id) ? 'text-amber-400' : m.stage === 'done' ? 'text-emerald-400' : 'text-muted'}>
                  {busyOf(m.id) ? `${progress[m.id].status === 'paused' ? 'Paused · ' : ''}${progress[m.id].step}` : STAGE[m.stage ?? 'new']}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-line p-2">
          <button className="mb-2 flex w-full items-center justify-between rounded-md border border-line px-3 py-1.5 text-left text-xs text-muted transition hover:bg-panel2 hover:text-slate-200"
            title="AI token usage — click for details" onClick={() => setShowUsage(true)}>
            <span>AI tokens today</span>
            <span className="tabular-nums text-slate-200">{usage ? `${usage.today.estimated ? '~' : ''}${fmtTok(usage.today.input + usage.today.output)}${usage.today.cost > 0 ? ` · ${fmtCost(usage.today.cost)}` : ''}` : '…'}</span>
          </button>
          <button className="btn w-full" onClick={() => setShowSettings(true)}>⚙ Settings</button>
        </div>
      </aside>

      {/* ───────── main ───────── */}
      <main className="@container min-w-0 overflow-auto">
        {!cur && (
          <div className="mx-auto mt-24 max-w-md text-center">
            <h1 className="text-xl font-semibold">Turn recordings into notes</h1>
            <ol className="mt-6 space-y-3 text-left text-sm text-slate-300">
              {[
                <>Pick the type, then click <i>Import video or audio</i>.</>,
                <>The app transcribes, finds who spoke and writes an AI summary.</>,
                <>Browse the timeline, highlights and subtitles; export, or ask Claude Code / Codex through MCP.</>
              ].map((t, k) => (
                <li key={k} className="flex items-start gap-3">
                  <span className="mt-px grid size-5 flex-none place-items-center rounded-full bg-accent/20 text-xs font-semibold text-blue-300">{k + 1}</span>
                  <span className="min-w-0 flex-1 leading-relaxed">{t}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {cur && (
          <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-5">
            {/* header */}
            <div className="flex items-center gap-2">
              {editing === null ? (
                <>
                  <h1 className="min-w-0 truncate text-xl font-semibold" title={cur.meta.title}>{cur.meta.title}</h1>
                  <Badge>{kindOf(cur.meta)}</Badge>
                  <button className="btn px-2 py-0.5 text-xs" onClick={() => setEditing(cur.meta.title)}>Rename</button>
                  {ins?.title && ins.title !== cur.meta.title && (
                    <button className="btn px-2 py-0.5 text-xs" title={ins.title} onClick={() => void saveTitle(ins.title!)}>Use AI title</button>
                  )}
                </>
              ) : (
                <input autoFocus value={editing} onChange={(e) => setEditing(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void saveTitle(editing); if (e.key === 'Escape') setEditing(null) }}
                  onBlur={() => void saveTitle(editing)}
                  className="min-w-0 flex-1 rounded-md border border-accent bg-panel px-3 py-1 text-xl font-semibold outline-none" />
              )}
            </div>

            <div className="grid gap-4 @5xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,1fr)] @5xl:items-start">
            <div className="flex min-w-0 flex-col gap-4">
            {/* video */}
            {cur.meta.media === 'audio' ? (
              <Card>
                <audio ref={video as React.RefObject<HTMLAudioElement>} controls src={mediaUrl(cur.playback)} className="w-full"
                  onError={(e) => setVerr(`${e.currentTarget.error?.code}: ${e.currentTarget.error?.message}`)}
                  onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} />
                {caps && cues.length > 0 && (
                  <div className="mt-4 flex min-h-40 flex-col justify-center gap-2 text-center">
                    {[ci - 1, ci, ci + 1].map((i, pos) => {
                      const c = cues[i]
                      if (!c) return <p key={`s${pos}`} className="min-h-6" />
                      const gone = pos === 1 && now > c.end + 3 // silence: dim the last line
                      return (
                        <p key={`s${pos}`} onClick={() => seek(c.start)}
                          className={`cursor-pointer whitespace-pre-line px-4 transition ${pos === 1 ? `text-2xl font-medium leading-snug ${gone ? 'text-slate-500' : 'text-white'}` : 'text-sm text-muted hover:text-slate-300'}`}>
                          {cueLabel(c, i, subOpts)}
                        </p>
                      )
                    })}
                  </div>
                )}
              </Card>
            ) : (
              <video ref={video as React.RefObject<HTMLVideoElement>} controls src={mediaUrl(cur.playback)}
                onError={(e) => setVerr(`${e.currentTarget.error?.code}: ${e.currentTarget.error?.message}`)}
                onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                className="max-h-[46vh] w-full rounded-xl bg-black">
                {vttUrl && <track key={vttUrl} kind="subtitles" src={vttUrl} default />}
              </video>
            )}
            {verr && <div className="rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-200">Video failed to load: {verr}</div>}
            {cues.length > 0 && (
              <div className="-mt-2 flex items-center gap-2 text-xs text-muted">
                <button className="btn px-2.5 py-1 text-xs" title="Previous subtitle line (press [)" onClick={() => stepCue(-1)}>◀ Previous line</button>
                <button className="btn px-2.5 py-1 text-xs" title="Next subtitle line (press ])" onClick={() => stepCue(1)}>Next line ▶</button>
                <span>Keys: <kbd className="rounded border border-line px-1">[</kbd> <kbd className="rounded border border-line px-1">]</kbd></span>
              </div>
            )}

            {/* processing */}
            {(prog?.status === 'running' || prog?.status === 'paused') && (
              <Card title={prog.status === 'paused' ? 'Paused' : 'Processing…'} hint="You can keep browsing other recordings while this runs."
                right={<div className="flex gap-2">
                  {prog.status === 'running'
                    ? <button className="btn" onClick={() => void window.api.pause(cur.meta.id)}>Pause</button>
                    : <button className="btn btn-primary" onClick={() => void window.api.resume(cur.meta.id)}>Resume</button>}
                  <button className="btn" onClick={() => void window.api.cancel(cur.meta.id)}>Cancel</button>
                </div>}>
                {prog.steps && <Steps steps={prog.steps} now={tick} pct={prog.stepPct} />}
              </Card>
            )}
            {prog?.status === 'done' && prog.steps && (
              <div className="text-xs text-muted">Last run: {prog.steps.map((s) => `${s.name} ${dur((s.end ?? 0) - (s.start ?? 0) - s.pausedMs)}`).join(' · ')}</div>
            )}
            {prog?.status === 'cancelled' && <div className="rounded-lg bg-slate-700/40 px-3 py-2 text-sm text-slate-300">Cancelled. Finished steps are kept — use “Continue processing” to pick up where it stopped.</div>}
            {prog?.status === 'error' && <div className="whitespace-pre-wrap rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-200">{prog.message}</div>}
            {stage !== 'done' && !busyOf(cur.meta.id) && (
              <button className="btn btn-primary self-start" onClick={() => void window.api.run(cur.meta.id)}>Continue processing</button>
            )}

            {/* timeline */}
            {tr && (
              <Card title="Timeline" hint="Orange bars = busy moments · coloured lanes = who was speaking · triangles = highlights. Hover to preview, click to jump."
                right={<div className="flex gap-2">
                  {!cur.thumbs && cur.meta.media !== 'audio' && <button className="btn" onClick={async () => { await window.api.makeThumbs(cur.meta.id); await open(cur.meta.id) }}>Add previews</button>}
                  <button className="btn" onClick={() => void window.api.exportPng(renderTimelinePng(tr, ins ?? null, cur.meta.title, names), `${cur.meta.title}-timeline`)}>Save as image</button>
                </div>}>
                <Timeline tr={tr} ins={ins ?? null} now={now} thumbs={cur.thumbs} onSeek={seek} />
                {usedTypes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    {usedTypes.map((k) => (
                      <span key={k} className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm" style={{ background: TYPE_COLOR[k] }} />{TYPE_LABEL[k] ?? k}</span>
                    ))}
                  </div>
                )}
                {spkStats.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    <span className="text-xs text-muted">Speakers — names are detected automatically; type to change:</span>
                    <button className="btn px-2 py-0.5 text-xs" disabled={naming || stage === 'new' || stage === 'transcribed'} onClick={() => void autoNames(cur.meta.id, false)}
                      title="Names are filled in automatically. This re-runs the detection; it only fills empty boxes and never overwrites a name you typed.">
                      {naming ? 'Looking for names…' : '✨ Re-detect names'}
                    </button>
                    {spkStats.map(([s, sec]) => (
                      <label key={s} className="flex items-center gap-1.5 rounded-full border border-line bg-bg py-1 pl-2.5 pr-2 text-xs">
                        <i className="size-2.5 rounded-full" style={{ background: spkColor(s) }} />
                        <input value={names[s] ?? ''} placeholder={s} style={{ width: `${Math.max(2, [...(names[s] || s)].length * 1.1 + 0.5)}ch` }}
                          onChange={(e) => setNames({ ...names, [s]: e.target.value })}
                          onBlur={() => void window.api.setSpeakers(cur.meta.id, Object.fromEntries(Object.entries(names).filter(([, v]) => v.trim())))}
                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                          className="bg-transparent text-slate-200 outline-none placeholder:text-muted" />
                        <span className="text-muted tabular-nums" title="Total speaking time">{mmss(sec)}</span>
                        {(cur.extra ?? []).includes(s) && (
                          <button type="button" title="Remove this person (their lines go back to the original speaker)" className="text-muted hover:text-red-300"
                            onClick={async (e) => { e.preventDefault(); await window.api.removeSpeaker(cur.meta.id, s); await reload() }}>✕</button>
                        )}
                        {spkStats.length > 1 && (
                          <button type="button" title="This is the same person as another speaker" className="text-muted hover:text-white"
                            onClick={(e) => { e.preventDefault(); setMergeFrom(s); setMergeInto(spkStats.find(([o]) => o !== s)?.[0] ?? '') }}>⇄</button>
                        )}
                      </label>
                    ))}
                    {adding === null ? (
                      <button className="btn px-2 py-0.5 text-xs" title="Someone the automatic detection missed — then assign their lines in Transcript → Proofread"
                        onClick={() => setAdding('')}>＋ Add person</button>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <input autoFocus value={adding} placeholder="Name" onChange={(e) => setAdding(e.target.value)}
                          onKeyDown={async (e) => {
                            if (e.key === 'Escape') setAdding(null)
                            if (e.key === 'Enter' && adding.trim()) void addPerson()
                          }}
                          className="w-32 rounded-md border border-accent bg-bg px-2 py-0.5 text-xs outline-none" />
                        <button className="btn btn-primary px-2 py-0.5 text-xs" disabled={!adding.trim()}
                          onClick={() => void addPerson()}>Add</button>
                        <button className="btn px-2 py-0.5 text-xs" onClick={() => setAdding(null)}>Cancel</button>
                      </span>
                    )}
                    {nameNote && <p className="w-full text-xs text-muted">{nameNote}</p>}
                    {mergeFrom && (
                      <div className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-bg px-3 py-2 text-xs">
                        <span>Sometimes one person gets split into two speakers. Merge <b>{names[mergeFrom] || mergeFrom}</b> into</span>
                        <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className="rounded-md border border-line bg-panel px-2 py-1 text-xs outline-none">
                          {spkStats.filter(([o]) => o !== mergeFrom).map(([o]) => <option key={o} value={o}>{names[o] || o}</option>)}
                        </select>
                        <button className="btn btn-primary px-2 py-1 text-xs" onClick={async () => { await window.api.mergeSpeakers(cur.meta.id, mergeFrom, mergeInto); setMergeFrom(null); await reload() }}>Merge</button>
                        <button className="btn px-2 py-1 text-xs" onClick={() => setMergeFrom(null)}>Cancel</button>
                      </div>
                    )}
                    {Object.entries(cur.merge ?? {}).map(([from, into]) => (
                      <p key={from} className="w-full text-xs text-muted">
                        {from} is treated as the same person as {names[into] || into}.{' '}
                        <button className="text-accent hover:underline" onClick={async () => { await window.api.unmergeSpeaker(cur.meta.id, from); await reload() }}>Split back</button>
                      </p>
                    ))}
                  </div>
                )}
              </Card>
            )}

            </div>
            {/* tabs */}
            <div className="flex min-w-0 flex-col @5xl:sticky @5xl:top-5 @5xl:h-[calc(100vh-6.5rem)]">
              <div className="flex flex-none gap-1 border-b border-line">
                {TABS.map(([k, label]) => (
                  <button key={k} onClick={() => setTab(k)}
                    className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${tab === k ? 'border-accent text-white' : 'border-transparent text-muted hover:text-slate-200'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-auto pt-4 pr-1">
                {(tab === 'summary' || tab === 'highlights') && ins && (
                  <div className="mb-3 flex items-center gap-2">
                    {draft ? (
                      <>
                        <button className="btn btn-primary" onClick={() => void saveDraft()}>Save notes</button>
                        <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
                        <span className="text-xs text-muted">Editing — the player position is used for “Add … at”.</span>
                      </>
                    ) : (
                      <>
                        <button className="btn" onClick={() => setDraft(structuredClone(ins))}>✎ Edit notes</button>
                        <button className="btn" title="Re-write the notes from the corrected transcript" onClick={() => void window.api.regenInsights(cur.meta.id)}>↻ Regenerate from transcript</button>
                      </>
                    )}
                  </div>
                )}
                {(tab === 'summary' || tab === 'highlights') && draft && (
                  <NotesEditor draft={draft} setDraft={setDraft} now={now} speakers={spkStats.map(([s]) => s)} names={names} />
                )}
                {tab === 'summary' && !draft && (ins ? (
                  <div className="max-w-3xl">
                    <h2 className="text-lg font-semibold">{ins.title ?? cur.meta.title}</h2>
                    <p className="mt-2 leading-relaxed text-slate-300">{ins.summary}</p>
                    <H3>{cur.meta.kind === 'lecture' || ins.kind === 'lecture' ? 'Chapters' : 'Topics'} — click to jump</H3>
                    {ins.topics?.map((t, i) => <div key={i} className={rowCls} onClick={() => seek(t.t)}><Time t={t.t} />{t.title}</div>)}
                    {!!ins.concepts?.length && (<>
                      <H3>Key concepts</H3>
                      {ins.concepts.map((c, i) => <div key={i} className={rowCls} onClick={() => seek(c.t)}><Time t={c.t} /><b>{c.term}</b> — {c.definition}</div>)}
                    </>)}
                  </div>
                ) : <p className="text-sm text-muted">No AI summary yet — finish processing first.</p>)}

                {tab === 'transcript' && tr && (
                  <TranscriptPane id={cur.meta.id} segs={tr.segments} names={names} speakers={spkStats.map(([s]) => s)} now={now}
                    q={q} setQ={setQ} seek={seek} onEdit={editSegment} onReplaceAll={replaceAll}
                    onEditMany={async (idxs, patch) => { await window.api.editSegments(cur.meta.id, idxs, patch); await reload() }}
                    suggestions={cur.suggestions ?? []} terms={cur.terms ?? ''} aiBusy={busyOf(cur.meta.id)} aiPct={prog?.stepPct} onAiCancel={() => void window.api.cancel(cur.meta.id)}
                    onAiRun={(terms) => void window.api.proofreadRun(cur.meta.id, terms)}
                    onResolve={async (accept, dismiss) => { await window.api.proofreadResolve(cur.meta.id, accept, dismiss); await reload() }} />
                )}

                {tab === 'highlights' && !draft && (ins ? (
                  <>
                    <div className="mb-3 flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-xs text-muted">Category</span>
                      <button onClick={() => setTypeFilter(null)} className={`rounded-full border px-2.5 py-0.5 text-xs ${typeFilter === null ? 'border-accent text-white' : 'border-line text-muted hover:text-slate-200'}`}>All</button>
                      {usedTypes.map((k) => (
                        <button key={k} onClick={() => setTypeFilter(typeFilter === k ? null : k)}
                          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${typeFilter === k ? 'border-accent text-white' : 'border-line text-muted hover:text-slate-200'}`}>
                          <i className="size-2 rounded-full" style={{ background: TYPE_COLOR[k] }} />{TYPE_LABEL[k] ?? k}
                        </button>
                      ))}
                    </div>
                    {ins.highlights?.filter((h) => !typeFilter || h.type === typeFilter).map((h, i) => (
                      <div key={i} className={`${rowCls} flex items-center gap-3`} onClick={() => seek(h.t)}>
                        {cur.thumbs && <img className="w-24 flex-none rounded" src={thumbUrl(cur.thumbs, h.t)} />}
                        <div>
                          <Time t={h.t} /><Chip color={TYPE_COLOR[h.type] ?? '#999'}>{TYPE_LABEL[h.type] ?? h.type}</Chip>
                          <div>{h.title}</div>
                          {h.speaker && <div className="mt-0.5"><SpkLine s={h.speaker} names={names} /></div>}
                        </div>
                      </div>
                    ))}
                    {!!ins.action_items?.length && <H3>{ins.kind === 'lecture' ? 'Assignments & deadlines' : 'Action items'}</H3>}
                    {ins.action_items?.map((a, i) => (
                      <div key={i} className={rowCls} onClick={() => seek(a.t)}><Time t={a.t} />{a.text}{a.speaker && <div className="mt-0.5 pl-12"><SpkLine s={a.speaker} names={names} /></div>}</div>
                    ))}
                  </>
                ) : <p className="text-sm text-muted">No AI summary yet — finish processing first.</p>)}

                {tab === 'subtitles' && (tr ? (
                  <SubtitlesPanel caps={caps} setCaps={(v) => { setCaps(v); flag('caps', v) }} capSpk={capSpk} setCapSpk={(v) => { setCapSpk(v); flag('capSpk', v) }}
                    subSel={subSel} setSubSel={setSubSel} translated={Object.keys(cur.translations ?? {})} tLang={tLang} setTLang={setTLang}
                    onTranslate={() => void window.api.translate(cur.meta.id, tLang, cues.map((c) => c.text))}
                    onExportSrt={() => void window.api.exportText(toSrt(cues, subOpts), cur.meta.title, 'srt')}
                    onExportVtt={() => void window.api.exportText(toVtt(cues, subOpts), cur.meta.title, 'vtt')}
                    staleNote={transStale ? 'The transcript was edited after this translation, so the translation is hidden. Translate again to refresh it.' : ''}
                    lines={linesTrans ? <CueList cues={cues} opts={{ names, withSpk: capSpk, mode: 'trans', trans: linesTrans }} active={ci} seek={seek} /> : undefined}
                    linesHint="Translate the subtitles to see them here, line by line. The original wording is in the Transcript tab." />
                ) : <p className="text-sm text-muted">Subtitles appear once the recording is transcribed.</p>)}
              </div>
            </div>
            </div>
          </div>
        )}
      </main>
      <Chat id={cur?.meta.id ?? null} title={cur?.meta.title ?? ''} ready={!!cur?.transcript} getNow={() => video.current?.currentTime ?? 0} onSeek={cur ? seek : undefined} />
      {showUsage && <UsageDialog onClose={() => setShowUsage(false)} />}
      {showSetup && <SetupDialog onClose={() => setShowSetup(false)} />}
      {showSettings && <SettingsDialog onOpenSetup={() => { setShowSettings(false); setShowSetup(true) }} onClose={() => setShowSettings(false)} onFolderChanged={() => { setCur(null); curId.current = null; void refresh() }} />}
    </div>
  )
}
