import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

// GUI apps started from a dock/launcher/start menu often miss the PATH of the user's shell, so `uv`, `ffmpeg` and the AI CLIs
// (installed to ~/.local/bin, Homebrew, ~/.cargo/bin ...) would look "not installed". Add the usual places, and the login shell's PATH.
function fixPath(): void {
  if (IS_WIN) return
  const home = homedir()
  const extra = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', join(home, '.local', 'bin'), join(home, '.cargo', 'bin'), join(home, '.claude', 'local'), join(home, '.npm-global', 'bin')]
  let shellPath = ''
  try {
    const out = execFileSync(process.env.SHELL || (IS_MAC ? '/bin/zsh' : '/bin/sh'), ['-ilc', 'printf "__P__%s__P__" "$PATH"'], { timeout: 4000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    shellPath = /__P__(.*)__P__/s.exec(out)?.[1] ?? ''
  } catch { /* no login shell PATH: fall back to the usual places */ }
  const seen = new Set<string>()
  process.env.PATH = [...shellPath.split(':'), ...(process.env.PATH ?? '').split(':'), ...extra].filter((d) => d && !seen.has(d) && !!seen.add(d)).join(':')
}
// Per-user data folder for the pipeline (kept at the old Linux location so existing installs keep their Python environment and models).
const appDataHome = (): string => (IS_WIN ? (process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')) : IS_MAC ? join(homedir(), 'Library', 'Application Support') : join(homedir(), '.local', 'share'))
const pyBin = (root: string): string => (IS_WIN ? join(root, '.venv', 'Scripts', 'python.exe') : join(root, '.venv', 'bin', 'python'))

// Python pipeline: in dev it is the repo root; packaged, it ships in resources/ and is copied to a writable folder
// (it needs its own .venv and models next to the scripts, and an AppImage is read-only).
const DEV = !app.isPackaged
const PIPE_SRC = DEV ? resolve(app.getAppPath(), '..') : join(process.resourcesPath, 'pipeline')
const ROOT = DEV ? PIPE_SRC : join(appDataHome(), 'jiyan', 'pipeline')
function ensurePipeline(): void {
  if (DEV) return
  mkdirSync(ROOT, { recursive: true })
  const stamp = join(ROOT, '.app-version')
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === app.getVersion()) return
  for (const f of readdirSync(PIPE_SRC)) copyFileSync(join(PIPE_SRC, f), join(ROOT, f)) // .venv and models are left alone
  writeFileSync(stamp, app.getVersion())
}
const readJson = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null)

// Global config (shared with mcp_server.py): where projects live. Kept outside the data dir so it can be relocated.
const CFG_DIR = join(app.getPath('appData'), 'jiyan') // ~/.config/jiyan · ~/Library/Application Support/jiyan · %APPDATA%\\jiyan
const CFG = join(CFG_DIR, 'config.json')
mkdirSync(CFG_DIR, { recursive: true })
let DATA: string = (readJson(CFG)?.dataDir as string | undefined) ?? join(homedir(), 'MeetingNotes')
mkdirSync(DATA, { recursive: true })
const setDataDir = (d: string): void => { DATA = d; mkdirSync(d, { recursive: true }); writeFileSync(CFG, JSON.stringify({ dataDir: d }, null, 1)) }

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }
])

type Meta = { id: string; title: string; source: string; created: string; kind?: string; media?: 'video' | 'audio' }
const dir = (id: string) => join(DATA, id)

// Fill empty speaker names from the LLM's suggestions; never overwrite a name the user typed, skip low confidence.
function applyNameSuggestions(id: string): Record<string, string> {
  const sug = (readJson(join(dir(id), 'names.json')) ?? {}) as Record<string, { name?: string; confidence?: string }>
  const cur = (readJson(join(dir(id), 'speakers.json')) ?? {}) as Record<string, string>
  const merge = readEF(id).merge
  for (const [s0, g] of Object.entries(sug)) {
    const s = canon(s0, merge) ?? s0
    if (g.name?.trim() && g.confidence !== 'low' && !cur[s]?.trim()) cur[s] = g.name.trim()
  }
  writeFileSync(join(dir(id), 'speakers.json'), JSON.stringify(cur, null, 1))
  return cur
}

function listMeetings(): (Meta & { stage: string })[] {
  return readdirSync(DATA, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(DATA, d.name, 'meta.json')))
    .map((d) => {
      const m = readJson(join(DATA, d.name, 'meta.json')) as Meta
      const stage = existsSync(join(dir(m.id), 'insights.json')) ? 'done'
        : existsSync(join(dir(m.id), 'spk.json')) ? 'diarized'
        : existsSync(join(dir(m.id), 'transcript.json')) ? 'transcribed' : 'new'
      const kind = m.kind ?? (readJson(join(dir(m.id), 'insights.json')) as { kind?: string } | null)?.kind ?? 'meeting'
      return { ...m, kind, stage }
    })
    .sort((a, b) => b.created.localeCompare(a.created))
    .sort((a, b) => { // saved manual order; recordings not in it yet (new imports) stay on top, newest first
      const o = (readJson(join(DATA, 'order.json')) ?? []) as string[]
      const ia = o.indexOf(a.id), ib = o.indexOf(b.id)
      return (ia < 0 ? -1 : ia) - (ib < 0 ? -1 : ib) || 0
    })
}

const playbackName = (m: Meta): string => (m.media === 'audio' ? 'playback.m4a' : 'playback.mp4')

const THUMB_STEP = 10
const thumbsDir = (id: string): string => join(dir(id), 'thumbs')
async function makeThumbs(id: string, track = true, onFrac?: (f: number) => void): Promise<void> {
  const pb = join(dir(id), 'playback.mp4')
  if (!existsSync(pb) || existsSync(join(thumbsDir(id), '00001.jpg'))) return
  mkdirSync(thumbsDir(id), { recursive: true })
  const dur = onFrac ? await probeDuration(pb) : 0
  await runCmd('ffmpeg', ['-v', 'error', '-nostats', '-progress', 'pipe:1', '-y', '-i', pb, '-vf', `fps=1/${THUMB_STEP},scale=320:-1`, '-q:v', '5', join(thumbsDir(id), '%05d.jpg')], { ...(track ? { id, step: 'Extracting thumbnails' } : {}), onLine: onFrac ? ffmpegLine(dur, onFrac) : undefined })
}

const probeDuration = async (f: string): Promise<number> =>
  Number(await runCmd('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).catch(() => '0')) || 0
// ffmpeg -progress emits out_time_us=...; convert to a 0..1 fraction of the known duration
const ffmpegLine = (dur: number, cb: (f: number) => void) => (l: string): void => {
  const m = /^out_time_us=(\d+)/.exec(l)
  if (m && dur > 0) cb(Math.min(Number(m[1]) / 1e6 / dur, 1))
}

const USAGE_LOG = join(CFG_DIR, 'usage.jsonl')
/** Environment for every AI call: which assistant to use, and where harness.py appends token usage. */
const llmEnv = (rec: string | null, purpose: string, settings: object = getSettings()): NodeJS.ProcessEnv => ({
  MEETING_HARNESS: JSON.stringify(settings), JIYAN_USAGE_LOG: USAGE_LOG, JIYAN_REC: rec ?? '', JIYAN_PURPOSE: purpose
})

const SETTINGS = join(CFG_DIR, 'settings.json')
if (!existsSync(SETTINGS) && existsSync(join(DATA, 'settings.json'))) copyFileSync(join(DATA, 'settings.json'), SETTINGS)
const defaultSettings = { harness: 'claude', model: '', extra: '', custom: '', lang: 'auto' }
const getSettings = (): typeof defaultSettings => ({ ...defaultSettings, ...(readJson(SETTINGS) ?? {}) })

type Job = { pid: number; step: string; paused: boolean }
const jobs = new Map<string, Job>()
const cancelled = new Set<string>()
const cancelStep = new Map<string, string>()

function runCmd(cmd: string, args: string[], opts: { cwd?: string; input?: string; env?: NodeJS.ProcessEnv; id?: string; step?: string; onLine?: (l: string) => void } = {}): Promise<string> {
  return new Promise((ok, fail) => {
    // tracked jobs run in their own process group so pause/cancel reach uv's python child too
    const p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, detached: !!opts.id && !IS_WIN, windowsHide: true })
    if (opts.id && p.pid) jobs.set(opts.id, { pid: p.pid, step: opts.step ?? '', paused: false })
    let out = '', err = ''
    let buf = ''
    p.stdout.on('data', (b) => {
      out = (out + b).slice(-4000)
      if (!opts.onLine) return
      buf += b
      const lines = buf.split('\n'); buf = lines.pop() ?? ''
      lines.forEach(opts.onLine)
    })
    p.stderr.on('data', (b) => (err += b))
    p.on('error', fail)
    p.on('close', (c) => {
      if (opts.id) jobs.delete(opts.id)
      return c === 0 ? ok(out) : fail(new Error(`${cmd} exit ${c}: ${(err || out).slice(-600)}`))
    })
    if (opts.input !== undefined) p.stdin.end(opts.input)
  })
}

const STEPS: [string, string, (d: string, src: string, kind: string) => string[]][] = [
  ['transcript.json', 'Transcribing', (d, src) => ['transcribe.py', src, join(d, 'transcript.json')]],
  ['spk.json', 'Identifying speakers', (d) => ['diarize.py', join(d, 'transcript.json'), join(d, 'spk.json')]],
  ['names.json', 'Finding speaker names', (d) => ['name_speakers.py', join(d, 'spk.json'), join(d, 'names.json')]],
  ['insights.json', 'AI analysis', (d, _s, kind) => ['analyze.py', join(d, 'spk.json'), join(d, 'insights.json'), kind]]
]

type StepInfo = { name: string; state: 'pending' | 'running' | 'done'; start?: number; end?: number; pausedMs: number; pauseStart?: number }
const runState = new Map<string, StepInfo[]>()
const running = new Set<string>()

/** Stop a job and everything it started: POSIX process group, or taskkill /T on Windows. */
function killTree(pid: number, resume: boolean): void {
  if (IS_WIN) { try { spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* gone */ } return }
  try { if (resume) process.kill(-pid, 'SIGCONT'); process.kill(-pid, 'SIGKILL') } catch { /* already gone */ }
}

function cancelJob(id: string): void {
  const j = jobs.get(id)
  if (!j) return
  cancelled.add(id); cancelStep.set(id, j.step)
  killTree(j.pid, j.paused)
}

async function runPipeline(win: BrowserWindow, id: string): Promise<void> {
  if (running.has(id)) return
  running.add(id)
  const meta = readJson(join(dir(id), 'meta.json')) as Meta
  const send = (p: object) => win.webContents.send('pipeline', { id, ...p })
  try {
    const pb = join(dir(id), playbackName(meta))
    const needRemux = !existsSync(pb)
    const needThumbs = pb.endsWith('.mp4') && !existsSync(join(thumbsDir(id), '00001.jpg'))
    const todo = STEPS.filter(([f]) => !existsSync(join(dir(id), f)))
    const plan: StepInfo[] = [
      ...(needRemux ? ['Preparing playback file'] : []), ...(needThumbs ? ['Extracting thumbnails'] : []), ...todo.map(([, l]) => l)
    ].map((name) => ({ name, state: 'pending' as const, pausedMs: 0 }))
    runState.set(id, plan)
    const info = (name: string): StepInfo => plan.find((s) => s.name === name)!
    const report = (name: string, frac?: number): void => {
      const s = info(name)
      if (s.state === 'pending') { s.state = 'running'; s.start = Date.now() }
      send({ step: name, status: 'running', stepPct: frac ?? null, steps: plan })
    }
    const finish = (name: string): void => { const s = info(name); s.state = 'done'; s.end = Date.now() }
    if (needRemux) {
      const label = 'Preparing playback file'
      report(label)
      const a = pb.endsWith('.m4a') ? ['-c:a', 'aac'] : ['-c', 'copy', '-movflags', '+faststart']
      const dur = await probeDuration(meta.source)
      await runCmd('ffmpeg', ['-v', 'error', '-nostats', '-progress', 'pipe:1', '-y', '-i', meta.source, ...a, pb],
        { id, step: label, onLine: ffmpegLine(dur, (f) => report(label, f)) })
      finish(label)
    }
    if (needThumbs) {
      const label = 'Extracting thumbnails'
      report(label)
      await makeThumbs(id, true, (f) => report(label, f))
      finish(label)
    }
    for (const [file, label, args] of todo) {
      report(label)
      await runCmd('uv', ['run', 'python', ...args(dir(id), meta.source, meta.kind ?? 'meeting')], {
        cwd: ROOT, env: llmEnv(id, file === 'names.json' ? 'names' : file === 'insights.json' ? 'summary' : 'pipeline'), id, step: label,
        onLine: (l) => { const p = /^PROGRESS ([\d.]+)/.exec(l); if (p) report(label, Number(p[1])) }
      }).catch((e) => { throw new Error(`${label} failed: ${e.message}`) })
      if (file === 'names.json') applyNameSuggestions(id)
      finish(label)
    }
    send({ step: 'Done', status: 'done', steps: runState.get(id) })
  } catch (e) {
    if (cancelled.has(id)) {
      // drop partial outputs of the interrupted step so a later resume redoes it cleanly
      const st = cancelStep.get(id)
      if (st === 'Preparing playback file') rmSync(join(dir(id), playbackName(meta)), { force: true })
      if (st === 'Extracting thumbnails') rmSync(thumbsDir(id), { recursive: true, force: true })
      send({ step: 'Cancelled', status: 'cancelled' })
    } else send({ step: 'Error', status: 'error', message: String(e) })
  } finally {
    running.delete(id)
    cancelled.delete(id)
    runState.delete(id)
  }
}

const transDir = (id: string): string => join(dir(id), 'translations')
const langSlug = (l: string): string => l.replace(/\W+/g, '_')

async function runTranslate(win: BrowserWindow, id: string, lang: string, cues: string[]): Promise<void> {
  if (running.has(id)) return
  running.add(id)
  const send = (p: object): void => win.webContents.send('pipeline', { id, ...p })
  const name = `Translating subtitles to ${lang}`
  const plan: StepInfo[] = [{ name, state: 'running', start: Date.now(), pausedMs: 0 }]
  runState.set(id, plan)
  try {
    mkdirSync(transDir(id), { recursive: true })
    const inp = join(transDir(id), `${langSlug(lang)}.in.json`)
    writeFileSync(inp, JSON.stringify(cues))
    send({ step: name, status: 'running', stepPct: 0, steps: plan })
    await runCmd('uv', ['run', 'python', 'translate.py', inp, join(transDir(id), `${langSlug(lang)}.json`), lang], {
      cwd: ROOT, env: llmEnv(id, 'translate'), id, step: name,
      onLine: (l) => { const p = /^PROGRESS ([\d.]+)/.exec(l); if (p) send({ step: name, status: 'running', stepPct: Number(p[1]), steps: plan }) }
    })
    rmSync(inp, { force: true })
    plan[0].state = 'done'; plan[0].end = Date.now()
    send({ step: 'Done', status: 'done', steps: plan })
  } catch (e) {
    if (cancelled.has(id)) send({ step: 'Cancelled', status: 'cancelled' })
    else send({ step: 'Error', status: 'error', message: `Translation failed: ${String(e)}` })
  } finally {
    running.delete(id); cancelled.delete(id); runState.delete(id)
  }
}

// ───── first-run setup: tools, Python environment, models ─────
const MODELS = join(ROOT, 'models')
const SEG_DIR = join(MODELS, 'sherpa-onnx-pyannote-segmentation-3-0')
const EMB = join(MODELS, '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx')
const WHISPER_CACHE = join(process.env.HF_HOME ?? join(homedir(), '.cache', 'huggingface'), 'hub', 'models--mobiuslabsgmbh--faster-whisper-large-v3-turbo')
const probe = (cmd: string, args: string[]): Promise<string | null> => runCmd(cmd, args).then((o) => o.split('\n')[0].trim() || 'ok', () => null)
const have = (bin: string): Promise<boolean> => (IS_WIN ? runCmd('where', [bin]) : runCmd('sh', ['-c', `command -v ${bin}`])).then(() => true, () => false)

async function setupStatus(): Promise<object> {
  const [uv, ffmpeg, claude, codex, pi] = await Promise.all([probe('uv', ['--version']), probe('ffmpeg', ['-version']), have('claude'), have('codex'), have('pi')])
  return {
    uv, ffmpeg, root: ROOT,
    venv: existsSync(pyBin(ROOT)),
    speakerModels: existsSync(join(SEG_DIR, 'model.onnx')) && existsSync(EMB),
    whisper: existsSync(WHISPER_CACHE),
    harness: { claude, codex, pi },
    mcp: `uv run --project ${ROOT} python ${join(ROOT, 'mcp_server.py')}`
  }
}

async function setupRun(win: BrowserWindow): Promise<void> {
  const st = (await setupStatus()) as { venv: boolean; speakerModels: boolean; whisper: boolean }
  const plan: StepInfo[] = [
    ...(st.venv ? [] : ['Python environment (~500 MB)']), ...(st.speakerModels ? [] : ['Speaker models (~45 MB)']), ...(st.whisper ? [] : ['Speech recognition model (~1.6 GB)'])
  ].map((name) => ({ name, state: 'pending' as const, pausedMs: 0 }))
  const send = (p: object): void => win.webContents.send('setup', { steps: plan, ...p })
  const run = async (name: string, fn: () => Promise<void>): Promise<void> => {
    const s = plan.find((x) => x.name === name)
    if (!s) return
    s.state = 'running'; s.start = Date.now(); send({ status: 'running' })
    await fn()
    s.state = 'done'; s.end = Date.now(); send({ status: 'running' })
  }
  try {
    send({ status: 'running' })
    await run('Python environment (~500 MB)', async () => { await runCmd('uv', ['sync', '--frozen'], { cwd: ROOT }) })
    await run('Speaker models (~45 MB)', async () => {
      mkdirSync(MODELS, { recursive: true })
      const base = 'https://github.com/k2-fsa/sherpa-onnx/releases/download'
      if (!existsSync(join(SEG_DIR, 'model.onnx'))) {
        await runCmd('curl', ['-fL', '-o', join(MODELS, 'seg.tar.bz2'), `${base}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`])
        await runCmd('tar', ['xjf', join(MODELS, 'seg.tar.bz2'), '-C', MODELS]); rmSync(join(MODELS, 'seg.tar.bz2'), { force: true })
      }
      if (!existsSync(EMB)) await runCmd('curl', ['-fL', '-o', EMB, `${base}/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`])
    })
    await run('Speech recognition model (~1.6 GB)', async () => {
      await runCmd('uv', ['run', 'python', '-c', "from faster_whisper import WhisperModel; WhisperModel('large-v3-turbo', device='cpu', compute_type='int8')"], { cwd: ROOT })
    })
    send({ status: 'done' })
  } catch (e) {
    send({ status: 'error', message: String(e).slice(0, 800) })
  }
}

// ───── token usage: harness.py appends one JSON line per AI call to usage.jsonl ─────
type UsageRec = { ts: number; rec: string; purpose: string; harness: string; model: string; in: number; out: number; cache_read: number; cache_write: number; cost: number | null; est: boolean; ms: number }
function usageSummary(): object {
  const rows: UsageRec[] = existsSync(USAGE_LOG)
    ? readFileSync(USAGE_LOG, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as UsageRec] } catch { return [] } })
    : []
  const sod = new Date(); sod.setHours(0, 0, 0, 0)
  const agg = (rs: UsageRec[]): { calls: number; input: number; output: number; cacheRead: number; cost: number; estimated: boolean } => ({
    calls: rs.length,
    input: rs.reduce((s, r) => s + r.in + r.cache_read + r.cache_write, 0),
    output: rs.reduce((s, r) => s + r.out, 0),
    cacheRead: rs.reduce((s, r) => s + r.cache_read, 0),
    cost: rs.reduce((s, r) => s + (r.cost ?? 0), 0),
    estimated: rs.some((r) => r.est)
  })
  const by = (key: (r: UsageRec) => string): { key: string; calls: number; input: number; output: number; cost: number; estimated: boolean }[] => {
    const m = new Map<string, UsageRec[]>()
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r])
    return [...m].map(([k, rs]) => ({ key: k, ...agg(rs) })).sort((a, b) => b.input + b.output - (a.input + a.output))
  }
  const titles: Record<string, string> = {}
  for (const mm of listMeetings()) titles[mm.id] = mm.title
  return {
    today: agg(rows.filter((r) => r.ts * 1000 >= sod.getTime())),
    week: agg(rows.filter((r) => r.ts * 1000 >= Date.now() - 7 * 864e5)),
    all: agg(rows),
    byPurpose: by((r) => r.purpose),
    byRecording: by((r) => (r.rec ? (titles[r.rec] ?? r.rec) : '(not tied to a recording)')),
    byModel: by((r) => `${r.harness} · ${r.model}`),
    recent: rows.slice(-12).reverse().map((r) => ({ ts: r.ts, purpose: r.purpose, harness: r.harness, input: r.in + r.cache_read + r.cache_write, output: r.out, cost: r.cost, est: r.est, ms: r.ms }))
  }
}

// ───── proofreading overlay: originals stay untouched, edits.json is applied on read ─────
type SegPatch = { text?: string; spk?: string }
type Seg = { start: number; end: number; text: string; spk?: string; words?: unknown[]; edited?: boolean; orig?: string; origSpk?: string }
const editsFile = (id: string): string => join(dir(id), 'edits.json')
type EditsFile = { seg: Record<string, SegPatch>; merge: Record<string, string>; extra: string[] } // merge: {S3: 'S0'} = same person; extra: people added by hand
const readEF = (id: string): EditsFile => { const j = readJson(editsFile(id)) ?? {}; return { seg: j.seg ?? {}, merge: j.merge ?? {}, extra: j.extra ?? [] } }
const writeEF = (id: string, ef: EditsFile): void => writeFileSync(editsFile(id), JSON.stringify(ef, null, 1))
const readEdits = (id: string): Record<string, SegPatch> => readEF(id).seg
const writeEdits = (id: string, seg: Record<string, SegPatch>): void => writeEF(id, { ...readEF(id), seg })
const canon = (l: string | undefined, merge: Record<string, string>): string | undefined => {
  const seen = new Set<string>()
  while (l && merge[l] && !seen.has(l)) { seen.add(l); l = merge[l] }
  return l
}
function mapInsights<T extends { highlights?: { speaker?: string }[]; action_items?: { speaker?: string }[] } | null>(id: string, ins: T): T {
  if (!ins) return ins
  const merge = readEF(id).merge
  for (const x of [...(ins.highlights ?? []), ...(ins.action_items ?? [])]) if (x.speaker) x.speaker = canon(x.speaker, merge)
  return ins
}
function withEdits<T extends { segments: Seg[]; turns?: { spk: string }[] }>(id: string, tr: T | null): T | null {
  if (!tr) return tr
  const { seg: ed, merge } = readEF(id)
  tr.segments.forEach((s) => { s.spk = canon(s.spk, merge) })
  tr.turns?.forEach((u) => { u.spk = canon(u.spk, merge) ?? u.spk })
  const moved: { a: number; b: number; spk: string }[] = []
  tr.segments.forEach((s, i) => {
    const p = ed[String(i)]
    if (!p) return
    if (p.spk !== undefined && tr.turns) moved.push({ a: s.start, b: s.end, spk: p.spk })
    if (p.text !== undefined) { s.orig = s.text; s.text = p.text; s.edited = true }
    if (p.spk !== undefined) { s.origSpk = s.spk; s.spk = p.spk; s.edited = true }
  })
  if (tr.turns && moved.length) { // lanes follow the reassignment: cut the old speaker's turns out of that span, add the new one
    let turns = tr.turns as { s: number; e: number; spk: string }[]
    for (const { a, b, spk } of moved) {
      turns = turns.flatMap((u) => (u.spk === spk || u.e <= a || u.s >= b ? [u]
        : [...(u.s < a ? [{ ...u, e: a }] : []), ...(u.e > b ? [{ ...u, s: b }] : [])]))
      turns.push({ s: a, e: b, spk })
    }
    tr.turns = turns.sort((x, y) => x.s - y.s) as typeof tr.turns
  }
  return tr
}

// ───── agent chat: the agent reads transcript.txt / summary.md in the recording's folder ─────
type ChatMsg = { role: 'user' | 'assistant'; text: string; at: number; scope?: string }
const mm = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function writeReadable(id: string): void {
  const d = dir(id)
  const tr = withEdits(id, readJson(join(d, 'spk.json')) ?? readJson(join(d, 'transcript.json')))
  if (!tr) return
  const names = (readJson(join(d, 'speakers.json')) ?? {}) as Record<string, string>
  const meta = readJson(join(d, 'meta.json')) as Meta
  const nm = (s?: string): string => (s && names[s]) || s || '?'
  writeFileSync(join(d, 'transcript.txt'), `# ${meta.title}\n# one line per utterance: [mm:ss] speaker: text\n` +
    (tr.segments as { start: number; text: string; spk?: string }[]).map((s) => `[${mm(s.start)}] ${nm(s.spk)}: ${s.text}`).join('\n') + '\n')
  const ins = mapInsights(id, readJson(join(d, 'insights.json')))
  if (ins) {
    const L = (a: { t: number; speaker?: string }[] | undefined, f: (x: never) => string): string => (a ?? []).map((x) => `- [${mm(x.t)}] ${f(x as never)}`).join('\n')
    writeFileSync(join(d, 'summary.md'), `# ${meta.title}\n\n## Summary\n${ins.summary ?? ''}\n\n## Topics\n${L(ins.topics, (x: { title: string }) => x.title)}\n\n` +
      `## Highlights\n${L(ins.highlights, (x: { type: string; title: string; speaker?: string }) => `(${x.type}) ${x.title}${x.speaker ? ` — ${nm(x.speaker)}` : ''}`)}\n\n` +
      `## Action items\n${L(ins.action_items, (x: { text: string; speaker?: string }) => `${x.text}${x.speaker ? ` — ${nm(x.speaker)}` : ''}`)}\n`)
  }
}

const chatFile = (id: string | null, scope: 'this' | 'all'): string => (scope === 'all' || !id ? join(DATA, 'chat_all.json') : join(dir(id), 'chat.json'))

async function chatSend(id: string | null, scope: 'this' | 'all', message: string, at?: number): Promise<ChatMsg[]> {
  if (!id) scope = 'all'
  const file = chatFile(id, scope)
  const hist: ChatMsg[] = readJson(file) ?? []
  let cwd = id ? dir(id) : DATA
  const where = scope === 'all'
    ? 'The current folder contains one sub-folder per recording; each has transcript.txt and (if analysed) summary.md.'
    : 'The current folder is one recording. Files: transcript.txt (every utterance, timestamped, with speaker names) and summary.md (AI summary, topics, highlights, action items).'
  if (scope === 'all') { cwd = DATA; for (const m of listMeetings()) writeReadable(m.id) } else writeReadable(id!)
  const prompt = `You are the assistant inside a meeting/lecture notes app. ${where}
Answer using only those files; open them with your read tools. Cite evidence as [mm:ss] timestamps (add the recording folder name when several are involved).
If the files do not contain the answer, say so instead of guessing. Be concise. Reply in the language of the user's question.

Conversation so far:
${hist.slice(-10).map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join('\n') || '(none)'}

${scope === 'this' && at !== undefined ? `\n(The user's player is currently at [${mm(at)}].)` : ''}
User: ${message}`
  const reply = await runCmd('uv', ['run', 'python', 'harness.py', '--chat', cwd], {
    cwd: ROOT, input: prompt, env: llmEnv(scope === 'all' ? null : id, 'chat')
  })
  const now = Date.now()
  const next = [...hist, { role: 'user' as const, text: message, at: now, scope }, { role: 'assistant' as const, text: reply.trim(), at: Date.now() }]
  writeFileSync(file, JSON.stringify(next, null, 1))
  return next
}

// ───── AI proofreading: proposes corrections into proofread.json; nothing is applied until the user accepts ─────
type Suggestion = { i: number; from: string; to: string; why?: string }
async function runProofread(win: BrowserWindow, id: string, terms: string): Promise<void> {
  if (running.has(id)) return
  running.add(id)
  const send = (p: object): void => win.webContents.send('pipeline', { id, ...p })
  const name = 'Proofreading with AI'
  const plan: StepInfo[] = [{ name, state: 'running', start: Date.now(), pausedMs: 0 }]
  runState.set(id, plan)
  try {
    writeFileSync(join(dir(id), 'terms.txt'), terms)
    send({ step: name, status: 'running', stepPct: 0, steps: plan })
    await runCmd('uv', ['run', 'python', 'proofread.py', join(dir(id), 'spk.json'), join(dir(id), 'proofread.json'), '--terms', terms], {
      cwd: ROOT, env: llmEnv(id, 'proofread'), id, step: name,
      onLine: (l) => { const p = /^PROGRESS ([\d.]+)/.exec(l); if (p) send({ step: name, status: 'running', stepPct: Number(p[1]), steps: plan }) }
    })
    plan[0].state = 'done'; plan[0].end = Date.now()
    send({ step: 'Done', status: 'done', steps: plan })
  } catch (e) {
    if (cancelled.has(id)) send({ step: 'Cancelled', status: 'cancelled' })
    else send({ step: 'Error', status: 'error', message: `AI proofreading failed: ${String(e).slice(0, 600)}` })
  } finally {
    running.delete(id); cancelled.delete(id); runState.delete(id)
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400, height: 900,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  ipcMain.removeHandler('meetings:order')
  ipcMain.handle('meetings:order', (_e, ids: string[]) => writeFileSync(join(DATA, 'order.json'), JSON.stringify(ids)))
  ipcMain.removeHandler('meetings:list')
  ipcMain.handle('meetings:list', () => listMeetings())
  ipcMain.removeHandler('meeting:load')
  ipcMain.handle('meeting:load', (_e, id: string) => ({
    meta: readJson(join(dir(id), 'meta.json')),
    playback: (() => { const m = readJson(join(dir(id), 'meta.json')) as Meta; const p = join(dir(id), playbackName(m)); return existsSync(p) ? p : m.source })(),
    translations: (() => {
      const o: Record<string, string[]> = {}
      if (existsSync(transDir(id))) for (const f of readdirSync(transDir(id))) {
        if (f.endsWith('.json') && !f.endsWith('.in.json')) {
          const j = readJson(join(transDir(id), f)); if (Array.isArray(j)) o[f.slice(0, -5)] = j
        }
      }
      return o
    })(),
    namesChecked: existsSync(join(dir(id), 'names.json')),
    speakers: readJson(join(dir(id), 'speakers.json')) ?? {},
    thumbs: existsSync(join(thumbsDir(id), '00001.jpg')) ? { dir: thumbsDir(id), step: THUMB_STEP } : null,
    transcript: withEdits(id, readJson(join(dir(id), 'spk.json')) ?? readJson(join(dir(id), 'transcript.json'))),
    insights: mapInsights(id, readJson(join(dir(id), 'insights.json'))),
    merge: readEF(id).merge,
    extra: readEF(id).extra,
    suggestions: (readJson(join(dir(id), 'proofread.json')) ?? []) as Suggestion[],
    terms: existsSync(join(dir(id), 'terms.txt')) ? readFileSync(join(dir(id), 'terms.txt'), 'utf8') : ''
  }))
  ipcMain.removeHandler('meeting:import')
  ipcMain.handle('meeting:import', async (_e, kind: string) => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Video or audio', extensions: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'flv', 'ts', 'm4a', 'mp3', 'wav', 'flac', 'ogg', 'opus', 'aac', 'wma', 'amr'] }]
    })
    if (r.canceled) return null
    const source = r.filePaths[0]
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const id = `${stamp}-${basename(source, extname(source))}`.replace(/\s+/g, '_')
    mkdirSync(dir(id), { recursive: true })
    const probe = await runCmd('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', source]).catch(() => '')
    const meta: Meta = { media: probe.includes('video') ? 'video' : 'audio', id, title: basename(source, extname(source)), source, created: new Date().toISOString(), kind }
    writeFileSync(join(dir(id), 'meta.json'), JSON.stringify(meta, null, 1))
    void runPipeline(win, id)
    return id
  })
  ipcMain.removeHandler('speakers:set')
  ipcMain.handle('speakers:set', (_e, id: string, map: Record<string, string>) => writeFileSync(join(dir(id), 'speakers.json'), JSON.stringify(map, null, 1)))
  ipcMain.removeHandler('thumbs:make')
  ipcMain.handle('thumbs:make', async (_e, id: string) => { await makeThumbs(id) })
  ipcMain.removeHandler('export:text')
  ipcMain.handle('export:text', async (_e, content: string, name: string, ext: string) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: `${name}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, content, 'utf8')
    return r.filePath
  })
  ipcMain.removeHandler('export:png')
  ipcMain.handle('export:png', async (_e, dataUrl: string, name: string) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: `${name}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, Buffer.from(dataUrl.split(',')[1], 'base64'))
    return r.filePath
  })
  ipcMain.removeHandler('settings:get')
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.removeHandler('settings:set')
  ipcMain.handle('settings:set', (_e, s: object) => writeFileSync(SETTINGS, JSON.stringify({ ...defaultSettings, ...s }, null, 1)))
  ipcMain.removeHandler('settings:test')
  ipcMain.handle('settings:test', async (_e, s: object) => {
    const t0 = Date.now()
    try {
      const out = await runCmd('uv', ['run', 'python', 'harness.py', 'Reply with just the two letters OK'], {
        cwd: ROOT, env: llmEnv(null, 'test', { ...defaultSettings, ...s })
      })
      return { ok: true, ms: Date.now() - t0, text: out.trim().slice(0, 200) }
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, text: String(e).slice(0, 600) }
    }
  })
  ipcMain.removeHandler('usage:summary')
  ipcMain.handle('usage:summary', () => usageSummary())
  ipcMain.removeHandler('setup:status')
  ipcMain.handle('setup:status', () => setupStatus())
  ipcMain.removeHandler('setup:run')
  ipcMain.handle('setup:run', () => void setupRun(win))
  ipcMain.removeHandler('proofread:run')
  ipcMain.handle('proofread:run', (_e, id: string, terms: string) => void runProofread(win, id, terms))
  ipcMain.removeHandler('proofread:resolve')
  ipcMain.handle('proofread:resolve', (_e, id: string, accept: { i: number; text: string }[], dismiss: number[]) => {
    if (accept.length) {
      const ef = readEF(id)
      for (const a of accept) ef.seg[String(a.i)] = { ...ef.seg[String(a.i)], text: a.text }
      writeEF(id, ef)
    }
    const f = join(dir(id), 'proofread.json')
    const handled = new Set([...accept.map((a) => a.i), ...dismiss])
    writeFileSync(f, JSON.stringify(((readJson(f) ?? []) as Suggestion[]).filter((s) => !handled.has(s.i))))
  })
  ipcMain.removeHandler('speakers:add')
  ipcMain.handle('speakers:add', (_e, id: string, name: string) => {
    const ef = readEF(id)
    const tr = readJson(join(dir(id), 'spk.json')) as { segments: { spk?: string }[] } | null
    const used = new Set([...ef.extra, ...(tr?.segments ?? []).map((s) => s.spk ?? '')])
    let n = 1
    while (used.has(`P${n}`)) n++
    const label = `P${n}`
    ef.extra.push(label); writeEF(id, ef)
    const nf = join(dir(id), 'speakers.json')
    const names = (readJson(nf) ?? {}) as Record<string, string>
    if (name.trim()) names[label] = name.trim()
    writeFileSync(nf, JSON.stringify(names, null, 1))
    return label
  })
  ipcMain.removeHandler('speakers:remove')
  ipcMain.handle('speakers:remove', (_e, id: string, label: string) => {
    const ef = readEF(id)
    ef.extra = ef.extra.filter((x) => x !== label)
    for (const k of Object.keys(ef.seg)) if (ef.seg[k].spk === label) { delete ef.seg[k].spk; if (!Object.keys(ef.seg[k]).length) delete ef.seg[k] }
    writeEF(id, ef)
    const nf = join(dir(id), 'speakers.json')
    const names = (readJson(nf) ?? {}) as Record<string, string>
    delete names[label]
    writeFileSync(nf, JSON.stringify(names, null, 1))
  })
  ipcMain.removeHandler('edit:segments')
  ipcMain.handle('edit:segments', (_e, id: string, idxs: number[], patch: SegPatch) => {
    const ef = readEF(id)
    for (const i of idxs) ef.seg[String(i)] = { ...ef.seg[String(i)], ...patch }
    writeEF(id, ef)
  })
  ipcMain.removeHandler('speakers:merge')
  ipcMain.handle('speakers:merge', (_e, id: string, from: string, into: string) => {
    if (from === into) return
    const ef = readEF(id)
    const target = canon(into, ef.merge) ?? into
    if (target === from) return // would make a cycle
    ef.merge[from] = target
    for (const k of Object.keys(ef.merge)) if (ef.merge[k] === from) ef.merge[k] = target // things merged into `from` follow it
    writeEF(id, ef)
    const nf = join(dir(id), 'speakers.json')
    const names = (readJson(nf) ?? {}) as Record<string, string>
    if (names[from]?.trim() && !names[target]?.trim()) names[target] = names[from]
    delete names[from]
    writeFileSync(nf, JSON.stringify(names, null, 1))
  })
  ipcMain.removeHandler('speakers:unmerge')
  ipcMain.handle('speakers:unmerge', (_e, id: string, from: string) => {
    const ef = readEF(id)
    delete ef.merge[from]
    writeEF(id, ef)
  })
  ipcMain.removeHandler('edit:segment')
  ipcMain.handle('edit:segment', (_e, id: string, idx: number, patch: SegPatch | null) => {
    const ed = readEdits(id)
    if (patch === null) delete ed[String(idx)]
    else ed[String(idx)] = { ...ed[String(idx)], ...patch }
    writeEdits(id, ed)
  })
  ipcMain.removeHandler('edit:replaceAll')
  ipcMain.handle('edit:replaceAll', (_e, id: string, find: string, repl: string) => {
    if (!find) return 0
    const tr = withEdits<{ segments: Seg[] }>(id, readJson(join(dir(id), 'spk.json')) ?? readJson(join(dir(id), 'transcript.json')))
    if (!tr) return 0
    const ed = readEdits(id)
    let n = 0
    tr.segments.forEach((s, i) => {
      if (!s.text.includes(find)) return
      n += s.text.split(find).length - 1
      ed[String(i)] = { ...ed[String(i)], text: s.text.split(find).join(repl) }
    })
    writeEdits(id, ed)
    return n
  })
  ipcMain.removeHandler('insights:save')
  ipcMain.handle('insights:save', (_e, id: string, ins: object) => {
    const f = join(dir(id), 'insights.json')
    const bak = join(dir(id), 'insights.orig.json')
    if (existsSync(f) && !existsSync(bak)) copyFileSync(f, bak) // keep the AI's first version once
    writeFileSync(f, JSON.stringify(ins, null, 1))
  })
  ipcMain.removeHandler('insights:regen')
  ipcMain.handle('insights:regen', async (_e, id: string) => {
    const r = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Regenerate', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Regenerate the AI summary from the corrected transcript?',
      detail: 'The summary, topics, highlights and action items are rewritten, so manual edits to them are replaced. The previous version is kept as insights.prev.json in the recording folder.'
    })
    if (r.response !== 0) return false
    const f = join(dir(id), 'insights.json')
    if (existsSync(f)) copyFileSync(f, join(dir(id), 'insights.prev.json')), rmSync(f)
    void runPipeline(win, id)
    return true
  })
  ipcMain.removeHandler('chat:load')
  ipcMain.handle('chat:load', (_e, id: string | null, scope: 'this' | 'all') => readJson(chatFile(id, scope)) ?? [])
  ipcMain.removeHandler('chat:send')
  ipcMain.handle('chat:send', async (_e, id: string | null, scope: 'this' | 'all', message: string, at?: number) => {
    try { return { ok: true, messages: await chatSend(id, scope, message, at) } } catch (e) { return { ok: false, error: String(e).slice(0, 600) } }
  })
  ipcMain.removeHandler('chat:clear')
  ipcMain.handle('chat:clear', (_e, id: string | null, scope: 'this' | 'all') => rmSync(chatFile(id, scope), { force: true }))
  ipcMain.removeHandler('speakers:suggest')
  ipcMain.handle('speakers:suggest', async (_e, id: string) => {
    try {
      await runCmd('uv', ['run', 'python', 'name_speakers.py', join(dir(id), 'spk.json'), join(dir(id), 'names.json')], { cwd: ROOT, env: llmEnv(id, 'names') })
      const speakers = applyNameSuggestions(id)
      return { ok: true, names: readJson(join(dir(id), 'names.json')), speakers }
    } catch (e) { return { ok: false, error: String(e).slice(0, 600) } }
  })
  ipcMain.removeHandler('translate:run')
  ipcMain.handle('translate:run', (_e, id: string, lang: string, cues: string[]) => void runTranslate(win, id, lang, cues))
  ipcMain.removeHandler('meeting:rename')
  ipcMain.handle('meeting:rename', (_e, id: string, title: string) => {
    const meta = readJson(join(dir(id), 'meta.json')) as Meta
    meta.title = title.trim() || meta.title
    writeFileSync(join(dir(id), 'meta.json'), JSON.stringify(meta, null, 1))
    return meta.title
  })
  ipcMain.removeHandler('config:get')
  ipcMain.handle('config:get', () => ({ dataDir: DATA, root: ROOT }))
  ipcMain.removeHandler('config:chooseDir')
  ipcMain.handle('config:chooseDir', async () => {
    if ([...jobs.keys()].length) {
      await dialog.showMessageBox(win, { type: 'info', message: 'Wait for running jobs to finish (or cancel them) before changing the project folder.' })
      return null
    }
    const r = await dialog.showOpenDialog(win, { title: 'Choose project folder', properties: ['openDirectory', 'createDirectory'], defaultPath: DATA })
    if (r.canceled) return null
    const next = r.filePaths[0]
    if (resolve(next) === resolve(DATA)) return DATA
    const old = listMeetings()
    let move = false
    if (old.length) {
      const a = await dialog.showMessageBox(win, {
        type: 'question', buttons: ['Move projects', 'Keep them where they are', 'Cancel'], defaultId: 0, cancelId: 2,
        message: `Move ${old.length} existing project(s) to the new folder?`,
        detail: `From: ${DATA}\nTo: ${next}\nOriginal recordings are not moved. Projects left behind will not appear in the app until you switch back.`
      })
      if (a.response === 2) return null
      move = a.response === 0
    }
    if (move) {
      const clash = old.filter((m) => existsSync(join(next, m.id)))
      if (clash.length) {
        await dialog.showMessageBox(win, { type: 'error', message: `The new folder already contains ${clash.length} project(s) with the same id; nothing was moved.` })
        return null
      }
      for (const m of old) {
        cpSync(dir(m.id), join(next, m.id), { recursive: true })
        rmSync(dir(m.id), { recursive: true, force: true })
      }
    }
    setDataDir(next)
    return DATA
  })
  ipcMain.removeHandler('meeting:pause')
  ipcMain.handle('meeting:pause', (_e, id: string) => {
    const j = jobs.get(id)
    if (!j || j.paused || IS_WIN) return // Windows has no SIGSTOP: pausing is not offered there
    process.kill(-j.pid, 'SIGSTOP'); j.paused = true
    const s = runState.get(id)?.find((x) => x.state === 'running'); if (s) s.pauseStart = Date.now()
    win.webContents.send('pipeline', { id, step: j.step, status: 'paused', steps: runState.get(id) })
  })
  ipcMain.removeHandler('meeting:resume')
  ipcMain.handle('meeting:resume', (_e, id: string) => {
    const j = jobs.get(id)
    if (!j || !j.paused) return
    process.kill(-j.pid, 'SIGCONT'); j.paused = false
    const s = runState.get(id)?.find((x) => x.state === 'running'); if (s?.pauseStart) { s.pausedMs += Date.now() - s.pauseStart; s.pauseStart = undefined }
    win.webContents.send('pipeline', { id, step: j.step, status: 'running', steps: runState.get(id) })
  })
  ipcMain.removeHandler('meeting:cancel')
  ipcMain.handle('meeting:cancel', (_e, id: string) => cancelJob(id))
  ipcMain.removeHandler('meeting:delete')
  ipcMain.handle('meeting:delete', async (_e, id: string) => {
    const meta = readJson(join(dir(id), 'meta.json')) as Meta | null
    const r = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1,
      message: `Delete "${meta?.title ?? id}"?`,
      detail: 'Removes the transcript, AI analysis, speaker names, thumbnails and playback copy from the app.\nYour original recording file is not touched.'
    })
    if (r.response !== 0) return false
    cancelJob(id)
    for (let i = 0; i < 20 && jobs.has(id); i++) await new Promise((ok) => setTimeout(ok, 100))
    rmSync(dir(id), { recursive: true, force: true })
    return true
  })
  ipcMain.removeHandler('meeting:run')
  ipcMain.handle('meeting:run', (_e, id: string) => void runPipeline(win, id))

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

void app.whenReady().then(() => {
  fixPath()
  ensurePipeline()
  protocol.handle('media', (req) => {
    let path = decodeURIComponent(new URL(req.url).pathname)
    if (IS_WIN && /^\/[A-Za-z]:/.test(path)) path = path.slice(1) // /C:/Users/... -> C:/Users/...
    console.log('[media]', req.method, req.headers.get('range') ?? '-', path)
    const size = statSync(path).size
    const type = path.endsWith('.jpg') ? 'image/jpeg' : path.endsWith('.mp4') ? 'video/mp4' : path.endsWith('.m4a') ? 'audio/mp4' : 'application/octet-stream'
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '')
    const start = m && m[1] ? Number(m[1]) : 0
    const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
    return new Response(body, {
      status: m ? 206 : 200,
      headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1),
        ...(m ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) }
    })
  })
  createWindow()
})
app.on('window-all-closed', () => app.quit())
