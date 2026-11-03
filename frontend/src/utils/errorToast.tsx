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

/** Error toast that shows the fix command (if any) in a copyable box. */
export function showError(title: string, message: string) {
  const { text, command } = splitCommand(message)
  toast.custom((t) => (
    <div
      role="alert"
      className={`flex items-start gap-3 p-4 rounded-xl border w-[min(92vw,420px)] ${t.visible ? 'animate-fade-up' : 'opacity-0'}`}
      style={{ background: 'var(--surface)', borderColor: 'color-mix(in srgb, var(--red) 35%, transparent)', boxShadow: 'var(--shadow-lg)' }}
    >
      <XCircle size={18} strokeWidth={2} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 1 }} />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{title}</p>
        <p className="text-[12.5px] mt-1 leading-relaxed break-words" style={{ color: 'var(--text2)' }}>{text}</p>
        {command && (
          <>
            <p className="text-[11.5px] mt-2.5 mb-1" style={{ color: 'var(--text3)' }}>À lancer sur le serveur :</p>
            <div className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ background: 'var(--surface2)' }}>
              <code className="flex-1 min-w-0 text-[11.5px] font-mono break-all" style={{ color: 'var(--text)' }}>{command}</code>
              <CopyButton command={command} />
            </div>
          </>
        )}
      </div>
      <button className="p-1 -m-1 rounded" style={{ color: 'var(--text3)' }} onClick={() => toast.dismiss(t.id)} aria-label="Fermer">
        <X size={14} />
      </button>
    </div>
  ), { duration: command ? 30_000 : 10_000 })
}
