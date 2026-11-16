import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowDownToLine, X } from 'lucide-react'
import { useTransfersSocket, type AddedEvent } from '@/hooks/useTransfersSocket'
import { PAGE_ID } from '@/services/transfersService'

/**
 * Admins, anywhere in Nexus: « Fichier reçu » when a file is sent from another device (as well
 * as the push notification, which iOS hides while the app is open). Touching it opens Aperçu.
 */
export default function TransferToasts() {
  const socket = useTransfersSocket()
  const navigate = useNavigate()

  useEffect(() => {
    if (!socket) return
    const onAdded = (e: AddedEvent) => {
      if (e.client === PAGE_ID || !e.items.length) return
      const title = e.items.length > 1 ? `${e.items.length} fichiers reçus` : 'Fichier reçu'
      const body = `${e.items.length > 1 ? e.items.map((t) => t.name).slice(0, 3).join(', ') : e.items[0].name}${e.from ? ` · depuis ${e.from}` : ''}`
      toast.custom((t) => (
        <div role="status"
          className="flex items-start gap-3 p-3 pr-2.5 rounded-[22px] glass-strong w-[min(92vw,380px)] text-body"
          style={{ opacity: t.visible ? 1 : 0, transition: 'opacity 200ms var(--ease-out)' }}>
          <ArrowDownToLine size={18} strokeWidth={1.75} className="flex-shrink-0 mt-px text-accent" aria-hidden="true" />
          <button type="button" className="flex-1 min-w-0 text-left" onClick={() => { toast.dismiss(t.id); navigate('/dashboard#transferts') }}>
            <span className="block font-semibold text-label">{title}</span>
            <span className="block text-label2 mt-0.5 break-words">{body}</span>
          </button>
          <button className="p-1 -m-0.5 rounded-[6px] text-label2 hoverable" onClick={() => toast.dismiss(t.id)} aria-label="Fermer">
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      ), { id: `transfer-${e.items[0].id}`, duration: 10_000 })
    }
    socket.on('transfer:added', onAdded)
    return () => { socket.off('transfer:added', onAdded) }
  }, [socket, navigate])

  return null
}
