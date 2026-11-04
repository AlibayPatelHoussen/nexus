import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CheckCircle2, XCircle, X } from 'lucide-react'
import { useDownloadsSocket } from '@/hooks/useDownloadsSocket'

export interface FinishedEvent { id: string; ok: boolean; title: string; body: string; url: string }

/**
 * Live toast when a download ends, wherever you are in Nexus (admins), in
 * addition to the push notification (iOS often shows no banner for an app in
 * the foreground). Touching it opens the title, like the notification.
 */
export default function DownloadToasts() {
  const socket = useDownloadsSocket()
  const navigate = useNavigate()

  useEffect(() => {
    if (!socket) return
    const onFinished = (e: FinishedEvent) => {
      toast.custom((t) => (
        <div role="status"
          className="flex items-start gap-3 p-3 pr-2.5 rounded-[12px] material-bar w-[min(92vw,380px)] text-body"
          style={{ boxShadow: 'var(--shadow-popover)', opacity: t.visible ? 1 : 0, transition: 'opacity 200ms var(--ease-out)' }}>
          {e.ok
            ? <CheckCircle2 size={18} strokeWidth={1.75} className="flex-shrink-0 mt-px text-ok-text" aria-hidden="true" />
            : <XCircle size={18} strokeWidth={1.75} className="flex-shrink-0 mt-px text-danger" aria-hidden="true" />}
          <button type="button" className="flex-1 min-w-0 text-left" onClick={() => { toast.dismiss(t.id); navigate(e.url) }}>
            <span className="block font-semibold text-label">{e.title}</span>
            <span className="block text-label2 mt-0.5 break-words">{e.body}</span>
          </button>
          <button className="p-1 -m-0.5 rounded-[6px] text-label2 hoverable" onClick={() => toast.dismiss(t.id)} aria-label="Fermer">
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      ), { id: `download-${e.id}`, duration: e.ok ? 8000 : 15000 })
    }
    socket.on('download:finished', onFinished)
    return () => { socket.off('download:finished', onFinished) }
  }, [socket, navigate])

  return null
}
