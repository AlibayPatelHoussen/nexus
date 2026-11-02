import { createContext, useContext } from 'react'

export interface ConfirmOptions {
  title:         string
  message?:      React.ReactNode
  /** Extra details (e.g. the list of files) shown in a scrollable box */
  details?:      string[]
  confirmLabel?: string
  cancelLabel?:  string
  /** Red, destructive action (delete…) */
  danger?:       boolean
}

export type Confirm = (options: ConfirmOptions) => Promise<boolean>

export const ConfirmContext = createContext<Confirm | null>(null)

/** `const confirm = useConfirm(); if (await confirm({ title: … })) …` */
export function useConfirm(): Confirm {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return ctx
}

