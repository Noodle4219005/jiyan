import type { Seg } from './types'

export type Cue = { start: number; end: number; text: string; spk?: string }

const isCjk = (s: string): boolean => /[぀-ヿ㐀-鿿]/.test(s)

/** Split segments into readable cues (≤ ~28 CJK chars or ~70 Latin chars) using word timestamps. */
export function toCues(segs: Seg[]): Cue[] {
  const cues: Cue[] = []
  for (const s of segs) {
    const limit = isCjk(s.text) ? 28 : 70
    if (s.text.length <= limit || (!s.words?.length && !s.edited)) { cues.push({ start: s.start, end: s.end, text: s.text, spk: s.spk }); continue }
    if (s.edited || !s.words?.length) { // word timings no longer match the text: split by characters, spread over the segment
      const n = Math.ceil(s.text.length / limit), per = Math.ceil(s.text.length / n), d = (s.end - s.start) / n
      for (let k = 0; k < n; k++) cues.push({ start: s.start + k * d, end: s.start + (k + 1) * d, text: s.text.slice(k * per, (k + 1) * per), spk: s.spk })
      continue
    }
    let buf = '', st = s.words[0].s, en = s.words[0].e
    for (const w of s.words) {
      if (buf && (buf + w.w).trim().length > limit) {
        cues.push({ start: st, end: en, text: buf.trim(), spk: s.spk }); buf = ''; st = w.s
      }
      buf += w.w; en = w.e
    }
    if (buf.trim()) cues.push({ start: st, end: Math.max(en, s.end), text: buf.trim(), spk: s.spk })
  }
  // keep cues from overlapping and at least readable
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1]
    if (cues[i].end - cues[i].start < 0.8) cues[i].end = cues[i].start + 0.8
    if (next && cues[i].end > next.start) cues[i].end = Math.max(next.start, cues[i].start + 0.05)
  }
  return cues
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
const ts = (t: number, sep: '.' | ','): string => {
  const ms = Math.round(t * 1000)
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`
}
export type SubOpts = { names: Record<string, string>; withSpk: boolean; mode?: 'orig' | 'trans' | 'both'; trans?: string[] }
export const cueLabel = (c: Cue, i: number, o: SubOpts): string => {
  const tr = o.trans?.[i]
  const body = o.mode === 'trans' && tr ? tr : o.mode === 'both' && tr ? `${c.text}\n${tr}` : c.text
  return o.withSpk && c.spk ? `${o.names[c.spk] || c.spk}: ${body}` : body
}

export const toVtt = (cues: Cue[], o: SubOpts): string =>
  'WEBVTT\n\n' + cues.map((c, i) => `${ts(c.start, '.')} --> ${ts(c.end, '.')}\n${cueLabel(c, i, o)}\n`).join('\n')

export const toSrt = (cues: Cue[], o: SubOpts): string =>
  cues.map((c, i) => `${i + 1}\n${ts(c.start, ',')} --> ${ts(c.end, ',')}\n${cueLabel(c, i, o)}\n`).join('\n')
