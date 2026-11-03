export type ThemePref = 'system' | 'light' | 'dark'
export const getThemePref = (): ThemePref => {
  try { const v = localStorage.getItem('theme'); return v === 'light' || v === 'dark' ? v : 'system' } catch { return 'system' }
}
export function applyTheme(p: ThemePref): void {
  const r = document.documentElement
  if (p === 'system') r.removeAttribute('data-theme'); else r.dataset.theme = p
  try { localStorage.setItem('theme', p) } catch { /* ignore */ }
}
