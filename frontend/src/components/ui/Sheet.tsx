import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDevice } from '@/hooks/useDevice'
import { cn } from '@/utils'
import { useModal, usePresence } from './useSheetLifecycle'

interface SheetProps {
  open:      boolean
  onClose:   () => void
  title?:    React.ReactNode
  /** Buttons at the bottom (desktop: right-aligned row; phone: stacked) */
  footer?:   React.ReactNode
  children?: React.ReactNode
  size?:     'sm' | 'md' | 'lg'
  role?:     'dialog' | 'alertdialog'
  /** False while an action runs: no dismiss by Escape / backdrop / swipe */
  dismissible?: boolean
  initialFocus?: React.RefObject<HTMLElement>
  className?: string
  /** Phone: header with "Annuler" / action buttons like a UIKit modal */
  phoneHeader?: { left?: React.ReactNode; right?: React.ReactNode }
}

const WIDTH = { sm: 'max-w-[420px]', md: 'max-w-[560px]', lg: 'max-w-[760px]' }

/**
 * Modal sheet that takes the native shape:
 * - desktop / tablet: macOS sheet dropping from the top of the window
 * - phone: iOS bottom sheet with a grabber, swipe down to dismiss
 */
export default function Sheet({
  open, onClose, title, footer, children, size = 'md', role = 'dialog',
  dismissible = true, initialFocus, className, phoneHeader,
}: SheetProps) {
  const phone = useDevice() === 'phone'
  const { mounted, closing } = usePresence(open, 220)
  const dismiss = () => { if (dismissible) onClose() }
  const ref = useModal(open, dismiss, initialFocus)
  const titleId = useId()

  // Swipe down to dismiss (phone)
  const [drag, setDrag] = useState(0)
  const start = useRef<{ y: number; t: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => { if (dismissible) { start.current = { y: e.clientY, t: Date.now() }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId) } }
  const onPointerMove = (e: React.PointerEvent) => { if (start.current) setDrag(Math.max(0, e.clientY - start.current.y)) }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current) return
    const dy = e.clientY - start.current.y
    const v = dy / Math.max(1, Date.now() - start.current.t)
    start.current = null
    setDrag(0)
    if (dy > 120 || v > 0.6) onClose()
  }

  if (!mounted) return null

  const header = title != null && (
    <h2 id={titleId} className={cn('text-headline text-label', phone ? 'text-center' : '')}>{title}</h2>
  )

  return createPortal(
    <div className="fixed inset-0 z-[100]" aria-hidden={false}>
      <div
        className="absolute inset-0"
        style={{ background: 'var(--overlay)', animation: `nx-fade-in ${closing ? '200ms reverse' : '200ms'} var(--ease-out) both` }}
        onClick={dismiss}
      />
      {phone ? (
        <div
          ref={ref}
          role={role}
          aria-modal="true"
          aria-labelledby={title != null ? titleId : undefined}
          className={cn('absolute inset-x-0 bottom-0 flex flex-col bg-surface rounded-t-sheet max-h-[92dvh]', className)}
          style={{
            boxShadow: 'var(--shadow-sheet)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            transform: drag ? `translateY(${drag}px)` : undefined,
            transition: drag ? 'none' : 'transform 250ms var(--ease-sheet)',
            animation: closing ? 'nx-sheet-up 220ms var(--ease-sheet) reverse both' : 'nx-sheet-up 300ms var(--ease-sheet) both',
          }}
        >
          <div
            className="flex-shrink-0 pt-2 pb-1 touch-none"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          >
            <div className="mx-auto w-9 h-[5px] rounded-full bg-label3 opacity-60" aria-hidden="true" />
            {(header || phoneHeader) && (
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 min-h-[44px]">
                <div className="justify-self-start">{phoneHeader?.left}</div>
                <div className="min-w-0">{header}</div>
                <div className="justify-self-end">{phoneHeader?.right}</div>
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
          {footer && <div className="flex flex-col gap-2 px-4 pb-4">{footer}</div>}
        </div>
      ) : (
        <div className="absolute inset-x-0 top-0 flex justify-center px-4 pointer-events-none" style={{ paddingTop: 'calc(var(--toolbar-h) + 8px)' }}>
          <div
            ref={ref}
            role={role}
            aria-modal="true"
            aria-labelledby={title != null ? titleId : undefined}
            className={cn('pointer-events-auto w-full flex flex-col bg-surface rounded-sheet max-h-[calc(100dvh-var(--toolbar-h)-32px)]', WIDTH[size], className)}
            style={{
              boxShadow: 'var(--shadow-sheet)',
              animation: closing ? 'nx-sheet-down 180ms var(--ease-out) reverse both' : 'nx-sheet-down 250ms var(--ease-sheet) both',
            }}
          >
            {header && <div className="px-5 pt-5 pb-1">{header}</div>}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2 px-5 pb-5 pt-1">{footer}</div>}
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
