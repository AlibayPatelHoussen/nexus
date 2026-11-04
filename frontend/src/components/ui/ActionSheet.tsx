import { useId } from 'react'
import { createPortal } from 'react-dom'
import { useDevice } from '@/hooks/useDevice'
import { cn } from '@/utils'
import Button from './Button'
import { useModal, usePresence } from './useSheetLifecycle'

export interface SheetAction {
  label:        string
  onSelect:     () => void
  destructive?: boolean
  icon?:        React.ReactNode
  disabled?:    boolean
}

interface ActionSheetProps {
  open:     boolean
  onClose:  () => void
  title?:   string
  message?: React.ReactNode
  actions:  SheetAction[]
  cancelLabel?: string
  /** Desktop: alert ("alertdialog") instead of a list */
  role?:    'dialog' | 'alertdialog'
}

/**
 * Choices for one item:
 * - phone: iOS action sheet (stacked buttons + separate "Annuler")
 * - desktop: macOS alert sheet with the buttons on one row
 */
export default function ActionSheet({ open, onClose, title, message, actions, cancelLabel = 'Annuler', role = 'dialog' }: ActionSheetProps) {
  const phone = useDevice() === 'phone'
  const { mounted, closing } = usePresence(open, 220)
  const ref = useModal(open, onClose)
  const titleId = useId()
  if (!mounted) return null

  const pick = (a: SheetAction) => { onClose(); a.onSelect() }

  return createPortal(
    <div className="fixed inset-0 z-[110]">
      <div className="absolute inset-0" style={{ background: 'var(--overlay)', animation: `nx-fade-in 200ms var(--ease-out) ${closing ? 'reverse' : ''} both` }} onClick={onClose} />
      {phone ? (
        <div
          ref={ref}
          role={role}
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          className="absolute inset-x-2 flex flex-col gap-2"
          style={{
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
            animation: closing ? 'nx-sheet-up 220ms var(--ease-sheet) reverse both' : 'nx-sheet-up 300ms var(--ease-sheet) both',
          }}
        >
          <div className="glass-strong rounded-[26px] overflow-hidden text-center">
            {(title || message) && (
              <div className="px-4 py-3.5 hairline-b">
                {title && <p id={titleId} className="text-[13px] font-semibold text-label2">{title}</p>}
                {message && <div className="text-[13px] text-label2 mt-0.5">{message}</div>}
              </div>
            )}
            {actions.map((a, i) => (
              <button
                key={a.label}
                type="button"
                disabled={a.disabled}
                onClick={() => pick(a)}
                className={cn(
                  'w-full min-h-[57px] text-[20px] pressable disabled:opacity-40 flex items-center justify-center gap-2',
                  a.destructive ? 'text-danger-text' : 'text-accent-text',
                  i > 0 && 'hairline-t',
                )}
              >
                {a.icon}{a.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} className="w-full min-h-[57px] rounded-pill glass-strong text-[20px] font-semibold text-accent-text pressable">
            {cancelLabel}
          </button>
        </div>
      ) : (
        <div className="absolute inset-x-0 top-0 flex justify-center px-4 pointer-events-none" style={{ paddingTop: 'calc(var(--toolbar-h) + 8px)' }}>
          <div
            ref={ref}
            role={role}
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            className="pointer-events-auto w-full max-w-[400px] bg-surface rounded-sheet p-5"
            style={{ boxShadow: 'var(--shadow-sheet)', animation: closing ? 'nx-sheet-down 180ms var(--ease-out) reverse both' : 'nx-sheet-down 250ms var(--ease-sheet) both' }}
          >
            {title && <h2 id={titleId} className="text-headline text-label">{title}</h2>}
            {message && <div className="text-body text-label2 mt-1.5">{message}</div>}
            <div className="flex flex-wrap justify-end gap-2 mt-5">
              <Button onClick={onClose} data-autofocus>{cancelLabel}</Button>
              {actions.map((a) => (
                <Button key={a.label} variant={a.destructive ? 'destructive' : 'secondary'} disabled={a.disabled} onClick={() => pick(a)}>
                  {a.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
