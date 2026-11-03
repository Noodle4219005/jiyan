import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  list: () => ipcRenderer.invoke('meetings:list'),
  load: (id: string) => ipcRenderer.invoke('meeting:load', id),
  importVideo: (kind: string) => ipcRenderer.invoke('meeting:import', kind),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s: unknown) => ipcRenderer.invoke('settings:set', s),
  testSettings: (s: unknown) => ipcRenderer.invoke('settings:test', s),
  setSpeakers: (id: string, map: unknown) => ipcRenderer.invoke('speakers:set', id, map),
  makeThumbs: (id: string) => ipcRenderer.invoke('thumbs:make', id),
  exportText: (c: string, n: string, e: string) => ipcRenderer.invoke('export:text', c, n, e),
  exportPng: (d: string, n: string) => ipcRenderer.invoke('export:png', d, n),
  setupStatus: () => ipcRenderer.invoke('setup:status'),
  setupRun: () => ipcRenderer.invoke('setup:run'),
  onSetup: (cb: (e: unknown) => void) => {
    const h = (_: unknown, e: unknown): void => cb(e)
    ipcRenderer.on('setup', h)
    return () => ipcRenderer.removeListener('setup', h)
  },
  mergeSpeakers: (id: string, from: string, into: string) => ipcRenderer.invoke('speakers:merge', id, from, into),
  unmergeSpeaker: (id: string, from: string) => ipcRenderer.invoke('speakers:unmerge', id, from),
  editSegment: (id: string, idx: number, patch: unknown) => ipcRenderer.invoke('edit:segment', id, idx, patch),
  replaceAll: (id: string, f: string, r: string) => ipcRenderer.invoke('edit:replaceAll', id, f, r),
  saveInsights: (id: string, ins: unknown) => ipcRenderer.invoke('insights:save', id, ins),
  regenInsights: (id: string) => ipcRenderer.invoke('insights:regen', id),
  chatLoad: (id: string | null, scope: string) => ipcRenderer.invoke('chat:load', id, scope),
  chatSend: (id: string | null, scope: string, msg: string, at?: number) => ipcRenderer.invoke('chat:send', id, scope, msg, at),
  chatClear: (id: string | null, scope: string) => ipcRenderer.invoke('chat:clear', id, scope),
  suggestNames: (id: string) => ipcRenderer.invoke('speakers:suggest', id),
  translate: (id: string, lang: string, cues: string[]) => ipcRenderer.invoke('translate:run', id, lang, cues),
  rename: (id: string, title: string) => ipcRenderer.invoke('meeting:rename', id, title),
  getConfig: () => ipcRenderer.invoke('config:get'),
  chooseDir: () => ipcRenderer.invoke('config:chooseDir'),
  pause: (id: string) => ipcRenderer.invoke('meeting:pause', id),
  resume: (id: string) => ipcRenderer.invoke('meeting:resume', id),
  cancel: (id: string) => ipcRenderer.invoke('meeting:cancel', id),
  deleteMeeting: (id: string) => ipcRenderer.invoke('meeting:delete', id),
  run: (id: string) => ipcRenderer.invoke('meeting:run', id),
  onPipeline: (cb: (e: unknown) => void) => {
    const h = (_: unknown, e: unknown): void => cb(e)
    ipcRenderer.on('pipeline', h)
    return () => ipcRenderer.removeListener('pipeline', h)
  }
})
