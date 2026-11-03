import toast from 'react-hot-toast'
import { XCircle, X } from 'lucide-react'
import CopyButton from '@/components/ui/CopyButton'

/** Error message sent by the server (falls back to a generic text). */
export function serverError(err: unknown): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string }
  return e?.response?.data?.error || e?.message || 'erreur inconnue'
}

/** Splits "… Sur le serveur : sudo chown …" into the explanation and the command. */
export function splitCommand(message: string): { text: string; command: string | null } {
  const m = message.match(/^(.*?)\s*Sur le serveur\s*:\s*(sudo .+)$/s)
  return m ? { text: m[1].trim(), command: m[2].trim() } : { text: message, command: null }
}

/** Error banner that shows the fix command (if any) in a copyable box. */
export function showError(title: string, message: string) {
  const { text, command } = splitCommand(message)
  toast.custom((t) => (
    <div
      role="alert"
      className="flex items-start gap-3 p-3 pr-2.5 rounded-[12px] material-bar w-[min(92vw,380px)] text-body"
      style={{ boxShadow: 'var(--shadow-popover)', opacity: t.visible ? 1 : 0, transition: 'opacity 200ms var(--ease-out)' }}
    >
      <XCircle size={18} strokeWidth={1.75} className="flex-shrink-0 mt-px text-danger" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-label">{title}</p>
        <p className="text-label2 mt-0.5 break-words">{text}</p>
        {command && (
          <>
            <p className="text-caption text-label2 mt-2.5 mb-1">À lancer sur le serveur :</p>
            <div className="flex items-center gap-2 rounded-[7px] bg-fill2 px-2.5 py-2">
              <code className="flex-1 min-w-0 text-caption font-mono break-all text-label">{command}</code>
              <CopyButton command={command} />
            </div>
          </>
        )}
      </div>
      <button className="p-1 -m-0.5 rounded-[6px] text-label2 hoverable" onClick={() => toast.dismiss(t.id)} aria-label="Fermer">
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  ), { duration: command ? 30_000 : 10_000 })
}
