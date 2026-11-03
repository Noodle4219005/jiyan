import type React from 'react'
import { Toggle } from './Parts'
import Select from './Select'

export const LANGS = ['English', 'Traditional Chinese', 'Simplified Chinese', 'Japanese', 'Korean', 'Spanish', 'French', 'German']
export const slug = (l: string): string => l.replace(/\W+/g, '_')


export default function SubtitlesPanel(p: {
  caps: boolean; setCaps: (v: boolean) => void
  capSpk: boolean; setCapSpk: (v: boolean) => void
  subSel: string; setSubSel: (v: string) => void
  translated: string[]               // slugs that have a translation
  tLang: string; setTLang: (v: string) => void
  onTranslate: () => void; onExportSrt: () => void; onExportVtt: () => void
  staleNote?: string; lines?: React.ReactNode; linesHint?: string
}): React.JSX.Element {
  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <h3 className="font-serif text-[15px] font-semibold tracking-wide">Show on video</h3>
        <Toggle label="Subtitles" on={p.caps} onChange={p.setCaps} />
        <Toggle label="Speaker names" hint="Prefix each line with who said it" on={p.capSpk} onChange={p.setCapSpk} />
        <label className="mt-2 flex items-center gap-3 text-sm">
          <span className="w-28 text-muted">Language</span>
          <Select value={p.subSel} onChange={p.setSubSel} options={[{ value: 'orig', label: 'Original' }, ...p.translated.flatMap((k) => { const L = LANGS.find((x) => slug(x) === k) ?? k; return [{ value: `trans:${L}`, label: L }, { value: `both:${L}`, label: `Original + ${L}` }] })]} />
        </label>
      </div>

      <div>
        <h3 className="font-serif text-[15px] font-semibold tracking-wide">Translate</h3>
        <p className="mt-0.5 text-xs text-muted">Uses the AI harness from Settings. Result appears in the Language list above.</p>
        <div className="mt-2 flex items-center gap-2">
          <Select value={p.tLang} onChange={p.setTLang} options={LANGS.map((l) => ({ value: l, label: l }))} />
          <button className="btn" onClick={p.onTranslate}>Translate subtitles</button>
        </div>
      </div>

      {p.staleNote && <p className="rounded-lg bg-warn px-3 py-2 text-xs text-warn-fg">{p.staleNote}</p>}

      <div>
        <h3 className="font-serif text-[15px] font-semibold tracking-wide">Export</h3>
        <p className="mt-0.5 text-xs text-muted">Saves what is selected under “Language” above, for use in other players.</p>
        <div className="mt-2 flex gap-2">
          <button className="btn" onClick={p.onExportSrt}>Save .srt</button>
          <button className="btn" onClick={p.onExportVtt}>Save .vtt</button>
        </div>
      </div>
      <div>
        <h3 className="font-serif text-[15px] font-semibold tracking-wide">Subtitle lines</h3>
        {p.lines ? (
          <>
            <p className="mb-2 mt-0.5 text-xs text-muted">Translated lines. Click one to jump the player there.</p>
            {p.lines}
          </>
        ) : <p className="mt-0.5 text-xs text-muted">{p.linesHint}</p>}
      </div>
    </div>
  )
}
