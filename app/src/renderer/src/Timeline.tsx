import { useState } from 'react'
import type React from 'react'
import type { Insights, Thumbs, Transcript } from './types'

export const TYPE_COLOR: Record<string, string> = {
  decision: '#22c55e', action: '#f59e0b', question: '#3b82f6', risk: '#ef4444', insight: '#a855f7',
  definition: '#06b6d4', example: '#84cc16', key_point: '#eab308', exam: '#f43f5e'
}
export const TYPE_LABEL: Record<string, string> = {
  decision: 'Decision', action: 'Action', question: 'Question', risk: 'Risk', insight: 'Insight',
  definition: 'Definition', example: 'Example', key_point: 'Key point', exam: 'Exam hint'
}
export const KIND_LABEL: Record<string, string> = { meeting: 'Meeting', lecture: 'Lecture', recording: 'Recording' }
export const SPK_COLOR = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb923c']
export const spkColor = (s?: string): string => SPK_COLOR[Number((s ?? 'S0').slice(1)) % SPK_COLOR.length]
export const mmss = (t: number): string => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`
export const mediaUrl = (path: string): string => `media://local${encodeURI(path)}`
export const thumbUrl = (th: Thumbs, t: number): string =>
  mediaUrl(`${th.dir}/${String(Math.floor(t / th.step) + 1).padStart(5, '0')}.jpg`)

const LANE = 10, HEAT = 60

export default function Timeline(p: {
  tr: Transcript; ins: Insights | null; now: number; thumbs: Thumbs | null; onSeek: (t: number) => void
}): React.JSX.Element {
  const D = p.tr.duration || p.ins?.duration || 1
  const spks = [...new Set((p.tr.turns ?? []).map((t) => t.spk))].sort()
  const W = 1000
  const x = (t: number): number => (t / D) * W
  const total = HEAT + spks.length * LANE + 24
  const [hover, setHover] = useState<{ t: number; px: number; w: number } | null>(null)
  const near = hover && p.ins?.highlights?.find((h) => Math.abs(h.t - hover.t) < D * 0.008)
  const at = (e: React.MouseEvent<SVGSVGElement>): { t: number; px: number; w: number } => {
    const r = e.currentTarget.getBoundingClientRect()
    return { t: ((e.clientX - r.left) / r.width) * D, px: e.clientX - r.left, w: r.width }
  }
  return (
    <div className="relative">
      <svg className="h-28 w-full cursor-pointer rounded-lg border border-line bg-panel" viewBox={`0 0 ${W} ${total}`} preserveAspectRatio="none"
        onClick={(e) => p.onSeek(at(e).t)} onMouseMove={(e) => setHover(at(e))} onMouseLeave={() => setHover(null)}>
        {p.ins?.heat.map((h) => (
          <rect key={h.t} x={x(h.t)} width={Math.max(x(p.ins!.bin) - 1, 1)} y={HEAT - h.score * HEAT}
            height={h.score * HEAT} fill={`rgba(249,115,22,${0.25 + h.score * 0.75})`} />
        ))}
        {spks.map((s, i) => (p.tr.turns ?? []).filter((t) => t.spk === s).map((t, j) => (
          <rect key={`${s}${j}`} x={x(t.s)} width={Math.max(x(t.e - t.s), 0.5)} y={HEAT + 4 + i * LANE}
            height={LANE - 2} fill={spkColor(s)} />
        )))}
        {p.ins?.highlights?.map((h, i) => (
          <polygon key={i} points={`${x(h.t) - 4},${total - 18} ${x(h.t) + 4},${total - 18} ${x(h.t)},${total - 6}`}
            fill={TYPE_COLOR[h.type] ?? '#999'} />
        ))}
        <line x1={x(p.now)} x2={x(p.now)} y1={0} y2={total} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {hover && <line x1={x(hover.t)} x2={x(hover.t)} y1={0} y2={total} stroke="#fff6" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute bottom-[calc(100%+8px)] z-10 w-48 rounded-lg border border-line bg-panel2 p-1.5 text-xs shadow-xl" style={{ left: Math.max(0, Math.min(hover.px - 96, hover.w - 192)) }}>
          {p.thumbs && <img className="block w-full rounded" src={thumbUrl(p.thumbs, hover.t)} />}
          <div className="mt-1 flex items-center gap-1.5"><b className="tabular-nums">{mmss(hover.t)}</b>{near && <span className="rounded-full px-2 py-px text-[10px] font-medium text-black" style={{ background: TYPE_COLOR[near.type] }}>{TYPE_LABEL[near.type] ?? near.type}</span>}</div>
          {near && <div className="mt-0.5 text-slate-300">{near.title}</div>}
        </div>
      )}
    </div>
  )
}

/** 以 canvas 重畫完整時間軸（含時間刻度、圖例、重點標記）並回傳 PNG data URL。 */
export function renderTimelinePng(tr: Transcript, ins: Insights | null, title: string, names: Record<string, string> = {}): string {
  const D = tr.duration || ins?.duration || 1
  const spks = [...new Set((tr.turns ?? []).map((t) => t.spk))].sort()
  const W = 2400, padL = 130, padR = 30, top = 70, heatH = 180, lane = 26
  const H = top + heatH + 20 + spks.length * lane + 120
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')!
  const x = (t: number): number => padL + (t / D) * (W - padL - padR)
  g.fillStyle = '#14161a'; g.fillRect(0, 0, W, H)
  g.fillStyle = '#e5e7eb'; g.font = 'bold 30px sans-serif'; g.fillText(title, padL, 42)
  g.font = '18px sans-serif'; g.fillStyle = '#9ca3af'; g.fillText('Heat (speech density, speaker turns, overlap)', padL, top - 6)
  ins?.heat.forEach((h) => {
    g.fillStyle = `rgba(249,115,22,${0.25 + h.score * 0.75})`
    const w = Math.max(x(h.t + ins.bin) - x(h.t) - 1, 1)
    g.fillRect(x(h.t), top + heatH - h.score * heatH, w, h.score * heatH)
  })
  spks.forEach((s, i) => {
    const y = top + heatH + 20 + i * lane
    g.fillStyle = '#9ca3af'; g.font = '16px sans-serif'; g.fillText(names[s] || s, 8, y + 17)
    g.fillStyle = spkColor(s)
    ;(tr.turns ?? []).filter((t) => t.spk === s).forEach((t) => g.fillRect(x(t.s), y, Math.max(x(t.e) - x(t.s), 1), lane - 6))
  })
  const base = top + heatH + 20 + spks.length * lane + 10
  g.strokeStyle = '#4b5563'; g.fillStyle = '#9ca3af'; g.font = '16px sans-serif'
  const step = D > 3600 ? 600 : D > 900 ? 300 : 60
  for (let t = 0; t <= D; t += step) { g.beginPath(); g.moveTo(x(t), base); g.lineTo(x(t), base + 8); g.stroke(); g.fillText(mmss(t), x(t) - 20, base + 28) }
  ins?.highlights?.forEach((h) => {
    g.fillStyle = TYPE_COLOR[h.type] ?? '#999'
    g.beginPath(); g.moveTo(x(h.t) - 7, base + 40); g.lineTo(x(h.t) + 7, base + 40); g.lineTo(x(h.t), base + 56); g.fill()
  })
  let lx = padL
  Object.entries(TYPE_COLOR).filter(([k]) => ins?.highlights?.some((h) => h.type === k)).forEach(([k, col]) => { g.fillStyle = col; g.fillRect(lx, H - 34, 16, 16); g.fillStyle = '#e5e7eb'; g.fillText(TYPE_LABEL[k] ?? k, lx + 24, H - 20); lx += 150 })
  return c.toDataURL('image/png')
}
