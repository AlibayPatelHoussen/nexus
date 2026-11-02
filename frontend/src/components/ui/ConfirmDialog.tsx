import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Trash2, X } from 'lucide-react'
import { ConfirmContext, type Confirm, type ConfirmOptions } from './useConfirm'

interface Pending extends ConfirmOptions { resolve: (ok: boolean) => void }

/** In-app replacement for window.confirm(): themed, accessible, keyboard friendly. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const confirmBtn = useRef<HTMLButtonElement>(null)
  const cancelBtn  = useRef<HTMLButtonElement>(null)

  const confirm = useCallback<Confirm>((options) => new Promise<boolean>((resolve) => {
    setPending({ ...options, resolve })
  }), [])

  const close = useCallback((ok: boolean) => {
    setPending((p) => { p?.resolve(ok); return null })
  }, [])

  useEffect(() => {
    if (!pending) return
    // Destructive actions focus "Annuler" first, so Enter never deletes by accident
    ;(pending.danger ? cancelBtn : confirmBtn).current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, close])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
          onClick={() => close(false)}
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
                {pending.danger ? <Trash2 size={18} strokeWidth={2} /> : <AlertTriangle size={18} strokeWidth={2} />}
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
              </div>
              <button className="p-1.5 -m-1.5 rounded-lg" style={{ color: 'var(--text3)' }} onClick={() => close(false)} aria-label="Fermer">
                <X size={16} />
              </button>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 pb-5">
              <button ref={cancelBtn} className="btn-ghost justify-center text-[13px]" onClick={() => close(false)}>
                {pending.cancelLabel ?? 'Annuler'}
              </button>
              <button
                ref={confirmBtn}
                className={`${pending.danger ? 'btn-danger' : 'btn-primary'} justify-center text-[13px] font-semibold`}
                style={pending.danger ? { background: 'var(--red)', color: 'white', border: 'none' } : undefined}
                onClick={() => close(true)}
              >
                {pending.confirmLabel ?? 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
