import type React from 'react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export type Opt = { value: string; label: string }

/**
 * Themed dropdown that replaces the native <select>, whose open list the browser draws itself and no CSS can style.
 * Keyboard: Enter/Space/↓ open; ↑/↓/Home/End move; Enter picks; Esc closes; typing jumps to a matching option.
 */
export default function Select(p: {
  value: string; onChange: (v: string) => void; options: Opt[]
  className?: string; size?: 'sm' | 'md'; disabled?: boolean; title?: string; placeholder?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0) // highlighted option index
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const typed = useRef({ s: '', t: 0 })
  const id = useId()
  const cur = p.options.findIndex((o) => o.value === p.value)
  const sm = p.size === 'sm'

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const below = window.innerHeight - r.bottom, above = r.top
    const up = below < 200 && above > below // not enough room under the button: open upward
    setPos({ left: r.left, width: Math.max(r.width, 140), top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined, maxH: Math.min(300, (up ? above : below) - 12) })
  }, [])

  const openList = (): void => { if (p.disabled) return; setHi(Math.max(cur, 0)); place(); setOpen(true) }
  const pick = (i: number): void => { const o = p.options[i]; if (o) p.onChange(o.value); setOpen(false); btn.current?.focus() }

  useLayoutEffect(() => { if (open) list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }) }, [open, hi])
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent): void => { if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false) }
    const close = (): void => setOpen(false)
    document.addEventListener('mousedown', down)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('resize', close); window.removeEventListener('blur', close) }
  }, [open])

  const onKey = (e: React.KeyboardEvent): void => {
    if (!open) { if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); openList() }; return }
    const n = p.options.length
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((hi + 1) % n) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((hi - 1 + n) % n) }
    else if (e.key === 'Home') { e.preventDefault(); setHi(0) }
    else if (e.key === 'End') { e.preventDefault(); setHi(n - 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(hi) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) }
    else if (e.key === 'Tab') setOpen(false)
    else if (e.key.length === 1) { // type-ahead
      const now = Date.now()
      typed.current = { s: (now - typed.current.t > 700 ? '' : typed.current.s) + e.key.toLowerCase(), t: now }
      const j = p.options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.s))
      if (j >= 0) setHi(j)
    }
  }

  return (
    <>
      <button ref={btn} type="button" role="combobox" aria-expanded={open} aria-controls={id} disabled={p.disabled} title={p.title}
        onClick={() => (open ? setOpen(false) : openList())} onKeyDown={onKey}
        className={`inline-flex min-w-0 items-center justify-between gap-2 rounded-md border bg-panel text-left text-fg transition hover:border-fg/30 disabled:pointer-events-none disabled:opacity-50 ${open ? 'border-accent' : 'border-line'} ${sm ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-sm'} ${p.className ?? ''}`}>
        <span className={`min-w-0 flex-1 truncate ${cur < 0 ? 'text-muted' : ''}`}>{cur >= 0 ? p.options[cur].label : (p.placeholder ?? '—')}</span>
        <ChevronDown className={`size-3.5 flex-none text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div ref={list} id={id} role="listbox" tabIndex={-1}
          style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.width, maxHeight: pos.maxH }}
          className="z-[200] overflow-auto rounded-lg border border-line bg-panel py-1 shadow-xl shadow-black/20 ring-1 ring-black/5">
          {p.options.map((o, i) => (
            <div key={o.value} data-i={i} role="option" aria-selected={i === cur}
              onMouseEnter={() => setHi(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}
              className={`flex cursor-pointer items-center gap-2 py-1.5 pl-3 pr-2.5 ${sm ? 'text-xs' : 'text-sm'} ${i === hi ? 'bg-panel2' : ''} ${i === cur ? 'font-medium text-fg' : 'text-fg2'}`}
              style={i === cur ? { boxShadow: 'inset 2px 0 0 var(--c-accent)' } : undefined}>
              <span className="min-w-0 flex-1 whitespace-nowrap">{o.label}</span>
              {i === cur && <Check className="size-3.5 flex-none text-link" />}
            </div>
          ))}
        </div>, document.body)}
    </>
  )
}
