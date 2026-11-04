import { useCallback, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDevice } from '@/hooks/useDevice'
import { cn } from '@/utils'
import Button from './Button'
import Spinner from './Spinner'
import { ConfirmContext, type Confirm, type ConfirmOptions } from './useConfirm'
import { useModal, usePresence } from './useSheetLifecycle'

interface Pending extends ConfirmOptions { resolve: (ok: boolean) => void }

/**
 * Replacement for window.confirm(), in the native shape:
 * - desktop: macOS alert sheet (destructive: "Annuler" has the focus)
 * - phone, destructive: iOS action sheet
 * - phone, other / with password: iOS alert
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [pw, setPw]           = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [busy, setBusy]       = useState(false)

  const confirm = useCallback<Confirm>((options) => new Promise<boolean>((resolve) => {
    setPw(''); setPwError(null); setBusy(false)
    setPending({ ...options, resolve })
  }), [])

  const close = useCallback((ok: boolean) => {
    setPw('')
    setPending((p) => { p?.resolve(ok); return null })
  }, [])

  const accept = useCallback(async () => {
    if (!pending?.password) { close(true); return }
    if (!pw || busy) return
    setBusy(true); setPwError(null)
    const error = await pending.password.submit(pw).catch((e: Error) => e.message || 'Erreur')
    setBusy(false)
    if (error) { setPwError(error); setPw('') }
    else close(true)
  }, [pending, pw, busy, close])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmView
        pending={pending} pw={pw} setPw={(v) => { setPw(v); setPwError(null) }} pwError={pwError} busy={busy}
        onCancel={() => { if (!busy) close(false) }} onAccept={() => void accept()}
      />
    </ConfirmContext.Provider>
  )
}

interface ViewProps {
  pending:  Pending | null
  pw:       string
  setPw:    (v: string) => void
  pwError:  string | null
  busy:     boolean
  onCancel: () => void
  onAccept: () => void
}

function ConfirmView({ pending, pw, setPw, pwError, busy, onCancel, onAccept }: ViewProps) {
  const phone = useDevice() === 'phone'
  const open = !!pending
  // Keep the last content while the closing animation runs
  const last = useRef<Pending | null>(null)
  if (pending) last.current = pending
  const p = pending ?? last.current
  const { mounted, closing } = usePresence(open, 200)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const pwRef = useRef<HTMLInputElement>(null)
  const focus = p?.password ? pwRef : p?.danger ? cancelRef : confirmRef
  const ref = useModal(open, onCancel, focus)
  const titleId = useId()
  const msgId = useId()
  if (!mounted || !p) return null

  const confirmLabel = p.confirmLabel ?? 'Confirmer'
  const cancelLabel = p.cancelLabel ?? 'Annuler'
  const actionSheet = phone && p.danger && !p.password

  const details = p.details && p.details.length > 0 && (
    <ul className="mt-3 max-h-36 overflow-y-auto rounded-[8px] bg-fill2 px-3 py-2 text-subhead text-label2 text-left space-y-0.5 font-mono">
      {p.details.slice(0, 50).map((d) => <li key={d} className="truncate" title={d}>{d}</li>)}
      {p.details.length > 50 && <li>… et {p.details.length - 50} autre(s)</li>}
    </ul>
  )

  const password = p.password && (
    <form className="mt-3 text-left" onSubmit={(e) => { e.preventDefault(); onAccept() }}>
      <label htmlFor="confirm-password" className="block text-subhead text-label2 mb-1.5">{p.password.label}</label>
      <input
        ref={pwRef}
        id="confirm-password"
        type="password"
        name="server-password"
        autoComplete="new-password"
        value={pw}
        disabled={busy}
        onChange={(e) => setPw(e.target.value)}
        aria-invalid={!!pwError}
        aria-describedby={pwError ? 'confirm-password-error' : undefined}
        className="w-full min-h-control max-md:min-h-[40px] px-2.5 rounded-[7px] bg-surface text-label border-[0.5px] border-separator outline-none focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_35%,transparent)] max-md:text-[17px]"
      />
      {pwError && <p id="confirm-password-error" role="alert" className="text-subhead text-danger-text mt-1.5">{pwError}</p>}
      {/* Enter submits */}
      <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
    </form>
  )

  const backdrop = (
    <div className="absolute inset-0" style={{ background: 'var(--overlay)', animation: `nx-fade-in 200ms var(--ease-out) ${closing ? 'reverse' : ''} both` }} onClick={onCancel} />
  )

  // ── iPhone, destructive: action sheet ─────────────────
  if (actionSheet) {
    return createPortal(
      <div className="fixed inset-0 z-[130]">
        {backdrop}
        <div
          ref={ref} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={p.message ? msgId : undefined}
          className="absolute inset-x-2 flex flex-col gap-2"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)', animation: closing ? 'nx-sheet-up 200ms var(--ease-sheet) reverse both' : 'nx-sheet-up 300ms var(--ease-sheet) both' }}
        >
          <div className="glass-strong rounded-[26px] overflow-hidden text-center">
            <div className="px-4 py-3.5 hairline-b">
              <h2 id={titleId} className="text-[13px] font-semibold text-label2">{p.title}</h2>
              {p.message && <div id={msgId} className="text-[13px] text-label2 mt-0.5">{p.message}</div>}
              {details}
            </div>
            <button ref={confirmRef} type="button" onClick={onAccept} className="w-full min-h-[57px] text-[20px] text-danger-text pressable">{confirmLabel}</button>
          </div>
          <button ref={cancelRef} type="button" onClick={onCancel} className="w-full min-h-[57px] rounded-pill glass-strong text-[20px] font-semibold text-accent-text pressable">{cancelLabel}</button>
        </div>
      </div>,
      document.body,
    )
  }

  // ── iPhone, other: centered alert ─────────────────────
  if (phone) {
    return createPortal(
      <div className="fixed inset-0 z-[130] grid place-items-center px-10">
        {backdrop}
        <div
          ref={ref} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={p.message ? msgId : undefined}
          className="relative w-full max-w-[300px] glass-strong rounded-[34px] overflow-hidden text-center"
          style={{ animation: closing ? 'nx-pop 150ms var(--ease-out) reverse both' : 'nx-pop 200ms var(--ease-out) both' }}
        >
          <div className="px-4 pt-5 pb-4">
            <h2 id={titleId} className="text-[17px] font-semibold text-label">{p.title}</h2>
            {p.message && <div id={msgId} className="text-[13px] text-label mt-1">{p.message}</div>}
            {details}
            {password}
          </div>
          <div className="grid grid-cols-2 hairline-t">
            <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className="min-h-[44px] text-[17px] text-accent-text pressable disabled:opacity-40" style={{ boxShadow: 'inset -0.5px 0 0 var(--separator)' }}>{cancelLabel}</button>
            <button
              ref={confirmRef} type="button" onClick={onAccept} disabled={busy || (!!p.password && !pw)}
              className={cn('min-h-[44px] text-[17px] font-semibold pressable disabled:opacity-40 inline-flex items-center justify-center gap-2', p.danger ? 'text-danger-text' : 'text-accent-text')}
            >
              {busy && <Spinner size={14} />}{confirmLabel}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  // ── Desktop / tablet: alert sheet from the top ────────
  return createPortal(
    <div className="fixed inset-0 z-[130]">
      {backdrop}
      <div className="absolute inset-x-0 top-0 flex justify-center px-4 pointer-events-none" style={{ paddingTop: 'calc(var(--toolbar-h) + 8px)' }}>
        <div
          ref={ref} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={p.message ? msgId : undefined}
          className="pointer-events-auto w-full max-w-[420px] bg-surface rounded-sheet p-5"
          style={{ boxShadow: 'var(--shadow-sheet)', animation: closing ? 'nx-sheet-down 180ms var(--ease-out) reverse both' : 'nx-sheet-down 250ms var(--ease-sheet) both' }}
        >
          <h2 id={titleId} className="text-headline text-label break-words">{p.title}</h2>
          {p.message && <div id={msgId} className="text-body text-label2 mt-1.5 break-words">{p.message}</div>}
          {details}
          {password}
          <div className="flex justify-end gap-2 mt-5">
            <Button ref={cancelRef} onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
            <Button
              ref={confirmRef}
              variant={p.danger ? 'destructive' : 'primary'}
              onClick={onAccept}
              loading={busy}
              disabled={!!p.password && !pw}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
