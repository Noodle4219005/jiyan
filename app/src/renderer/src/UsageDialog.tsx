import type React from 'react'
import { useEffect, useState } from 'react'
import type { UsageAgg, UsageRow, UsageSummary } from './types'

export const fmtTok = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n))
export const fmtCost = (c: number): string => (c > 0 ? `$${c < 0.1 ? c.toFixed(3) : c.toFixed(2)}` : '—')
const PURPOSE: Record<string, string> = { summary: 'AI summary', names: 'Speaker names', translate: 'Translation', proofread: 'AI proofread', chat: 'Chat', test: 'Connection test', pipeline: 'Other', other: 'Other' }

const Stat = ({ title, a }: { title: string; a: UsageAgg }): React.JSX.Element => (
  <div className="rounded-xl border border-line bg-bg p-3">
    <div className="text-xs text-muted">{title}</div>
    <div className="mt-1 text-lg font-semibold tabular-nums">{a.estimated && '~'}{fmtTok(a.input + a.output)} <span className="text-xs font-normal text-muted">tokens</span></div>
    <div className="mt-0.5 text-xs text-muted tabular-nums">in {fmtTok(a.input)} · out {fmtTok(a.output)} · {a.calls} call(s) · {fmtCost(a.cost)}</div>
  </div>
)
const Table = ({ title, rows, label }: { title: string; rows: UsageRow[]; label?: (k: string) => string }): React.JSX.Element => (
  <div>
    <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">{title}</h3>
    {rows.length === 0 ? <p className="text-xs text-muted">No calls yet.</p> : (
      <table className="w-full text-xs tabular-nums">
        <tbody>
          {rows.slice(0, 8).map((r) => (
            <tr key={r.key} className="border-t border-line">
              <td className="max-w-[16rem] truncate py-1 pr-2" title={r.key}>{label ? label(r.key) : r.key}</td>
              <td className="px-2 text-right text-muted">{r.calls}×</td>
              <td className="px-2 text-right">{r.estimated && '~'}{fmtTok(r.input + r.output)}</td>
              <td className="pl-2 text-right text-muted">{fmtCost(r.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
)

export default function UsageDialog(p: { onClose: () => void }): React.JSX.Element {
  const [u, setU] = useState<UsageSummary | null>(null)
  useEffect(() => { void window.api.usageSummary().then(setU) }, [])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm" onClick={p.onClose}>
      <div className="max-h-[90vh] w-[680px] overflow-auto rounded-xl border border-line bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="flex-1 text-base font-semibold">AI token usage</h2>
          <button className="btn px-2 py-1 text-xs" onClick={p.onClose}>✕</button>
        </div>
        {!u ? <p className="mt-3 text-sm text-muted">Loading…</p> : (
          <>
            <div className="mt-3 grid grid-cols-3 gap-2"><Stat title="Today" a={u.today} /><Stat title="Last 7 days" a={u.week} /><Stat title="All time" a={u.all} /></div>
            <div className="mt-4 grid grid-cols-2 gap-5">
              <Table title="By task" rows={u.byPurpose} label={(k) => PURPOSE[k] ?? k} />
              <Table title="By assistant / model" rows={u.byModel} />
              <div className="col-span-2"><Table title="By recording" rows={u.byRecording} /></div>
            </div>
            <h3 className="mb-1 mt-4 text-xs font-medium uppercase tracking-wider text-muted">Latest calls</h3>
            <table className="w-full text-xs tabular-nums">
              <tbody>
                {u.recent.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1 pr-2 text-muted">{new Date(r.ts * 1000).toLocaleTimeString()}</td>
                    <td className="px-2">{PURPOSE[r.purpose] ?? r.purpose}</td>
                    <td className="px-2 text-muted">{r.harness}</td>
                    <td className="px-2 text-right">{r.est && '~'}{fmtTok(r.input)} in / {fmtTok(r.output)} out</td>
                    <td className="px-2 text-right text-muted">{(r.ms / 1000).toFixed(1)}s</td>
                    <td className="pl-2 text-right text-muted">{r.cost != null ? fmtCost(r.cost) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              “in” counts everything sent to the model, including cached tokens. Only calls made by Jiyan are counted, not your other Claude/Codex use.
              Claude reports exact tokens and cost; Codex reports tokens but no cost; pi and custom commands report nothing, so their numbers (marked ~) are estimates.
              Calls run in a lean mode (no tools, no personal settings) to keep per-call overhead small.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
