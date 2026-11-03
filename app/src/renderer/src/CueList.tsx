import type React from 'react'
import { useEffect, useRef } from 'react'
import { rowCls, Time } from './Parts'
import { cueLabel, type Cue, type SubOpts } from './subtitles'

/** Every subtitle line; click one to jump the player to it. The line being played stays highlighted and in view. */
export default function CueList(p: { cues: Cue[]; opts: SubOpts; active: number; seek: (t: number) => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [p.active])
  return (
    <div>
      {p.cues.map((c, i) => (
        <div key={i} ref={i === p.active ? ref : undefined} onClick={() => p.seek(c.start)}
          className={`${rowCls} grid grid-cols-[3.25rem_1fr] items-baseline whitespace-pre-line ${i === p.active ? 'bg-blue-900/50' : ''}`}>
          <Time t={c.start} /><span>{cueLabel(c, i, p.opts)}</span>
        </div>
      ))}
    </div>
  )
}
