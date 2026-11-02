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
  /**
   * Ask for a password before confirming. `submit` runs the action and returns
   * an error message to show (the dialog stays open to retry) or null when done.
   */
  password?: {
    label:  string
    submit: (password: string) => Promise<string | null>
  }
}

export type Confirm = (options: ConfirmOptions) => Promise<boolean>

export const ConfirmContext = createContext<Confirm | null>(null)

/** Same as useConfirm, but null outside the provider (for hooks used in tests). */
export function useOptionalConfirm(): Confirm | null {
  return useContext(ConfirmContext)
}

/** `const confirm = useConfirm(); if (await confirm({ title: … })) …` */
export function useConfirm(): Confirm {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return ctx
}

