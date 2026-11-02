import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, KeyRound, Loader2, Trash2, X } from 'lucide-react'
import { ConfirmContext, type Confirm, type ConfirmOptions } from './useConfirm'

interface Pending extends ConfirmOptions { resolve: (ok: boolean) => void }

/** In-app replacement for window.confirm(): themed, accessible, keyboard friendly. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const confirmBtn = useRef<HTMLButtonElement>(null)
  const cancelBtn  = useRef<HTMLButtonElement>(null)
  const pwInput    = useRef<HTMLInputElement>(null)
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
    if (error) { setPwError(error); setPw(''); pwInput.current?.focus() }
    else close(true)
  }, [pending, pw, busy, close])

  useEffect(() => {
    if (!pending) return
    // Destructive actions focus "Annuler" first, so Enter never deletes by accident
    ;(pending.password ? pwInput : pending.danger ? cancelBtn : confirmBtn).current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) close(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, close, busy])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
          onClick={() => { if (!busy) close(false) }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="w-full sm:max-w-md card animate-fade-up !rounded-b-none sm:!rounded-[14px]"
            style={{ boxShadow: 'var(--shadow-lg)', paddingBottom: 'env(safe-area-inset-bottom)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 p-5 pb-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: pending.danger ? 'var(--red-dim)' : 'var(--blue-dim)', color: pending.danger ? 'var(--red)' : 'var(--blue)' }}
              >
                {pending.password ? <KeyRound size={18} strokeWidth={2} />
                  : pending.danger ? <Trash2 size={18} strokeWidth={2} /> : <AlertTriangle size={18} strokeWidth={2} />}
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h2 id="confirm-title" className="text-[15px] font-semibold break-words" style={{ color: 'var(--text)' }}>
                  {pending.title}
                </h2>
                {pending.message && (
                  <div className="text-[13px] mt-1.5 leading-relaxed break-words" style={{ color: 'var(--text2)' }}>{pending.message}</div>
                )}
                {pending.details && pending.details.length > 0 && (
                  <ul className="mt-3 max-h-40 overflow-y-auto rounded-lg px-3 py-2 text-[12px] font-mono space-y-0.5"
                    style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
                    {pending.details.slice(0, 50).map((d) => <li key={d} className="truncate" title={d}>{d}</li>)}
                    {pending.details.length > 50 && <li style={{ color: 'var(--text3)' }}>… et {pending.details.length - 50} autre(s)</li>}
                  </ul>
                )}
                {pending.password && (
                  <form className="mt-3" onSubmit={(e) => { e.preventDefault(); void accept() }}>
                    <label htmlFor="confirm-password" className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--text2)' }}>
                      {pending.password.label}
                    </label>
                    <input
                      ref={pwInput}
                      id="confirm-password"
                      type="password"
                      name="server-password"
                      autoComplete="new-password"
                      className="input w-full text-[14px]"
                      value={pw}
                      disabled={busy}
                      onChange={(e) => { setPw(e.target.value); setPwError(null) }}
                      aria-invalid={!!pwError}
                      aria-describedby={pwError ? 'confirm-password-error' : undefined}
                    />
                    {pwError && (
                      <p id="confirm-password-error" role="alert" className="text-[12px] mt-1.5" style={{ color: 'var(--red)' }}>{pwError}</p>
                    )}
                    {/* Enter submits */}
                    <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
                  </form>
                )}
              </div>
              <button className="p-1.5 -m-1.5 rounded-lg" style={{ color: 'var(--text3)' }} onClick={() => close(false)} disabled={busy} aria-label="Fermer">
                <X size={16} />
              </button>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 pb-5">
              <button ref={cancelBtn} className="btn-ghost justify-center text-[13px]" onClick={() => close(false)} disabled={busy}>
                {pending.cancelLabel ?? 'Annuler'}
              </button>
              <button
                ref={confirmBtn}
                className={`${pending.danger ? 'btn-danger' : 'btn-primary'} justify-center text-[13px] font-semibold`}
                style={pending.danger ? { background: 'var(--red)', color: 'white', border: 'none' } : undefined}
                onClick={() => void accept()}
                disabled={busy || (!!pending.password && !pw)}
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {pending.confirmLabel ?? 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
