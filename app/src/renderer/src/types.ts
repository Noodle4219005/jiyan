export type Meta = { media?: 'video' | 'audio'; kind?: string; id: string; title: string; source: string; created: string; stage?: string }
export type Word = { w: string; s: number; e: number; spk?: string }
export type Seg = { start: number; end: number; text: string; spk?: string; words: Word[]; edited?: boolean; orig?: string; origSpk?: string }
export type Turn = { s: number; e: number; spk: string }
export type Transcript = { duration: number; segments: Seg[]; turns?: Turn[] }
export type Highlight = { t: number; type: string; title: string; speaker?: string }
export type Insights = {
  duration: number; bin: number; title?: string; summary?: string
  heat: { t: number; score: number }[]
  topics?: { t: number; title: string }[]
  highlights?: Highlight[]
  concepts?: { t: number; term: string; definition: string }[]
  kind?: string
  action_items?: { t: number; text: string; speaker?: string }[]
}
export type Settings = { harness: 'claude' | 'codex' | 'pi' | 'custom'; model: string; extra: string; custom: string; lang: 'auto' | 'en' | 'zh-TW' }
export type SetupStatus = { uv: string | null; ffmpeg: string | null; venv: boolean; speakerModels: boolean; whisper: boolean; root: string; mcp: string; harness: { claude: boolean; codex: boolean; pi: boolean } }
export type SetupEvent = { steps: StepInfo[]; status: 'running' | 'done' | 'error'; message?: string }
export type Thumbs = { dir: string; step: number }
export type ChatMsg = { role: 'user' | 'assistant'; text: string; at: number; scope?: string }
export type NameGuess = { name: string; evidence: string; t: number | null; confidence: 'high' | 'medium' | 'low' }
export type Loaded = { merge: Record<string, string>; namesChecked: boolean; translations: Record<string, string[]>; speakers: Record<string, string>; thumbs: Thumbs | null; meta: Meta; playback: string; transcript: Transcript | null; insights: Insights | null }
export type StepInfo = { name: string; state: 'pending' | 'running' | 'done'; start?: number; end?: number; pausedMs: number; pauseStart?: number }
export type PipelineEvent = { steps?: StepInfo[]; stepPct?: number | null; id: string; step: string; status: 'running' | 'paused' | 'done' | 'error' | 'cancelled'; message?: string }

declare global {
  interface Window {
    api: {
      list: () => Promise<Meta[]>
      load: (id: string) => Promise<Loaded>
      importVideo: (kind: string) => Promise<string | null>
      getSettings: () => Promise<Settings>
      setSettings: (s: Settings) => Promise<void>
      testSettings: (s: Settings) => Promise<{ ok: boolean; ms: number; text: string }>
      setSpeakers: (id: string, map: Record<string, string>) => Promise<void>
      makeThumbs: (id: string) => Promise<void>
      exportText: (content: string, name: string, ext: string) => Promise<string | null>
      exportPng: (dataUrl: string, name: string) => Promise<string | null>
      setupStatus: () => Promise<SetupStatus>
      setupRun: () => Promise<void>
      onSetup: (cb: (e: SetupEvent) => void) => () => void
      mergeSpeakers: (id: string, from: string, into: string) => Promise<void>
      unmergeSpeaker: (id: string, from: string) => Promise<void>
      editSegment: (id: string, idx: number, patch: { text?: string; spk?: string } | null) => Promise<void>
      replaceAll: (id: string, find: string, repl: string) => Promise<number>
      saveInsights: (id: string, ins: Insights) => Promise<void>
      regenInsights: (id: string) => Promise<boolean>
      chatLoad: (id: string | null, scope: 'this' | 'all') => Promise<ChatMsg[]>
      chatSend: (id: string | null, scope: 'this' | 'all', msg: string, at?: number) => Promise<{ ok: true; messages: ChatMsg[] } | { ok: false; error: string }>
      chatClear: (id: string | null, scope: 'this' | 'all') => Promise<void>
      suggestNames: (id: string) => Promise<{ ok: true; names: Record<string, NameGuess>; speakers: Record<string, string> } | { ok: false; error: string }>
      translate: (id: string, lang: string, cues: string[]) => Promise<void>
      rename: (id: string, title: string) => Promise<string>
      getConfig: () => Promise<{ dataDir: string; root: string }>
      chooseDir: () => Promise<string | null>
      pause: (id: string) => Promise<void>
      resume: (id: string) => Promise<void>
      cancel: (id: string) => Promise<void>
      deleteMeeting: (id: string) => Promise<boolean>
      run: (id: string) => Promise<void>
      onPipeline: (cb: (e: PipelineEvent) => void) => () => void
    }
  }
}
