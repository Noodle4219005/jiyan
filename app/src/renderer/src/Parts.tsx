import type React from 'react'
import { mmss, spkColor } from './Timeline'
import type { StepInfo } from './types'

export const dur = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const Card = ({ title, hint, right, children, className = '' }: {
  title?: string; hint?: string; right?: React.ReactNode; children: React.ReactNode; className?: string
}): React.JSX.Element => (
  <section className={`rounded-xl border border-line bg-panel p-4 ${className}`}>
    {(title || right) && (
      <header className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {title && <h2 className="text-sm font-semibold text-slate-100">{title}</h2>}
          {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
        </div>
        {right}
      </header>
    )}
    {children}
  </section>
)

export const Toggle = ({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }): React.JSX.Element => (
  <label className="flex cursor-pointer items-center gap-3 py-1.5">
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={`relative h-5 w-9 flex-none rounded-full transition ${on ? 'bg-accent' : 'bg-line'}`}>
      <i className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
    <span className="text-sm">{label}{hint && <span className="ml-2 text-xs text-muted">{hint}</span>}</span>
  </label>
)

export const Spk = ({ s, names }: { s?: string; names: Record<string, string> }): React.JSX.Element => (
  <span className="mx-1.5 rounded-full px-2 py-px text-[11px] font-medium text-black" style={{ background: spkColor(s) }}>{(s && names[s]) || s || '?'}</span>
)
export const SpkLine = ({ s, names }: { s?: string; names: Record<string, string> }): React.JSX.Element => (
  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
    <i className="size-2 rounded-full" style={{ background: spkColor(s) }} />{(s && names[s]) || s || '?'}
  </div>
)
export const Time = ({ t }: { t: number }): React.JSX.Element => <b className="mr-1.5 font-mono text-xs font-normal text-muted tabular-nums">{mmss(t)}</b>
export const rowCls = 'cursor-pointer rounded-md px-2.5 py-1.5 text-sm leading-relaxed hover:bg-panel2'
export const H3 = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <h3 className="mb-1 mt-5 text-xs font-medium uppercase tracking-wider text-muted first:mt-0">{children}</h3>
)

export const Steps = ({ steps, now, pct }: { steps: StepInfo[]; now: number; pct?: number | null }): React.JSX.Element => (
  <div className="w-full space-y-2.5">
    {steps.map((s) => {
      const el = s.start ? (s.end ?? s.pauseStart ?? now) - s.start - s.pausedMs : 0
      const paused = s.state === 'running' && !!s.pauseStart
      const frac = s.state === 'done' ? 1 : s.state === 'running' ? pct : 0
      return (
        <div key={s.name} className={s.state === 'pending' ? 'opacity-50' : ''}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span>{s.state === 'done' ? '✓ ' : paused ? '⏸ ' : ''}{s.name}</span>
            <span className="font-mono tabular-nums text-muted">
              {s.state === 'running' && pct != null && `${Math.round(pct * 100)}% · `}{s.state === 'pending' ? '' : dur(el)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-bg">
            {frac == null
              ? <div className={`h-full w-1/3 rounded-full bg-accent ${paused ? '' : 'animate-[slide_1.2s_ease-in-out_infinite]'}`} />
              : <div className={`h-full rounded-full transition-[width] duration-300 ${s.state === 'done' ? 'bg-emerald-500' : paused ? 'bg-amber-400' : 'bg-accent'}`}
                  style={{ width: `${Math.round(frac * 100)}%` }} />}
          </div>
        </div>
      )
    })}
  </div>
)
