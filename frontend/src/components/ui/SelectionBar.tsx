import type { ReactNode } from 'react'

/** iPhone: the toolbar of a selection (« Tout sélectionner » … « Marquer comme lu »), right above the tab bar. */
export default function SelectionBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 z-40 material-bar hairline-t flex items-center justify-between px-4"
      style={{ bottom: 'calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px))', height: 48 }}>
      {children}
    </div>
  )
}
