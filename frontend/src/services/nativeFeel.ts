/** Text fields and logs keep the system menu (copy / paste); elsewhere a long press is ours. */
const KEEP_NATIVE = 'input, textarea, [contenteditable="true"], .selectable'

export const isTouchScreen = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none) and (pointer: coarse)').matches

/**
 * Touch screens: no browser context menu on a long press (« Ouvrir le lien », « Enregistrer
 * l'image »…, Android / iPad), like an installed app; Nexus' own long-press menus
 * (useContextMenu) still open. Text selection and link previews are turned off in index.css.
 * Returns the function that removes the listener.
 */
export function installNativeFeel(doc: Document = document): () => void {
  if (!isTouchScreen()) return () => {}
  const block = (e: Event) => {
    const t = e.target as Element | null
    if (!t?.closest?.(KEEP_NATIVE)) e.preventDefault()
  }
  doc.addEventListener('contextmenu', block)
  doc.addEventListener('dragstart', block)
  return () => {
    doc.removeEventListener('contextmenu', block)
    doc.removeEventListener('dragstart', block)
  }
}
