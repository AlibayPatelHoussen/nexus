import toast from 'react-hot-toast'
import { ArrowDownToLine, X } from 'lucide-react'
import { formatBytes } from '@/utils'
import { showError } from '@/utils/errorToast'
import Button from '@/components/ui/Button'

/**
 * Saving a file from Nexus on this device.
 *
 * - A browser (Safari, Chrome…): downloaded in place, the page stays (`<a download>`).
 * - The app from the iPhone's home screen: a download would leave its only page on the file
 *   with no way back (or on « about:blank » for a new page opened then sent there). The file is
 *   fetched, then given to the share sheet: « Enregistrer dans Fichiers », « Enregistrer
 *   l’image / la vidéo » (Photos), AirDrop… Too big to hold in memory (or no share sheet): it
 *   opens in the in-app browser sheet, whose « OK » brings Nexus back.
 *
 * Call it from the tap itself (the page opened for big files needs it).
 */

export interface SaveTarget {
  /** Ready to load (stream token included) */
  url:   string
  name:  string
  size?: number | null
  type?: string | null
}

/** Held in memory to be shared: above, the in-app browser sheet */
export const SHARE_MAX_BYTES = 1024 ** 3

export function isStandaloneApp(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
    || !!window.matchMedia?.('(display-mode: standalone)').matches
}

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  heif: 'image/heif', avif: 'image/avif', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska',
  webm: 'video/webm', avi: 'video/x-msvideo', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac',
  pdf: 'application/pdf', zip: 'application/zip', cbz: 'application/zip', txt: 'text/plain', md: 'text/markdown',
  json: 'application/json', csv: 'text/csv', doc: 'application/msword', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
/** The type the share sheet uses to offer the right places (Photos for an image or a video) */
export function typeOf(name: string, given?: string | null): string {
  if (given && given !== 'application/octet-stream') return given
  return TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}

function canShare(name: string, type: string): boolean {
  try { return !!navigator.canShare?.({ files: [new File([''], name, { type })] }) } catch { return false }
}

/** Downloaded in place, without leaving the page */
export function downloadLink(url: string, name: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function saveFile(t: SaveTarget): void {
  if (!isStandaloneApp()) { downloadLink(t.url, t.name); return }
  const type = typeOf(t.name, t.type)
  if (t.size == null || t.size > SHARE_MAX_BYTES || !canShare(t.name, type)) {
    // The in-app browser sheet (« OK » brings Nexus back): never this page, never a blank one
    window.open(t.url, '_blank')
    return
  }
  void fetchAndShare(t, type)
}

/** Fetched with its progress (« Annuler » stops it), then the share sheet */
async function fetchAndShare(t: SaveTarget, type: string) {
  const id = `save-${t.url}`
  const xhr = new XMLHttpRequest()
  let cancelled = false
  const show = (loaded: number, total: number) => {
    const pct = total ? Math.floor((loaded / total) * 100) : null
    toast.custom((tt) => (
      <div role="status" className="flex items-center gap-3 p-3 pr-2 rounded-[22px] glass-strong w-[min(92vw,380px)] text-body"
        style={{ opacity: tt.visible ? 1 : 0, transition: 'opacity 200ms var(--ease-out)' }}>
        <ArrowDownToLine size={18} strokeWidth={1.75} className="flex-shrink-0 text-accent" aria-hidden="true" />
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-label truncate">{t.name}</span>
          <span className="block mt-1.5 h-[4px] rounded-full bg-fill overflow-hidden" role="progressbar" aria-label={`Préparation de ${t.name}`}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
            <span className="block h-full rounded-full bg-accent transition-[width] duration-slow ease-out" style={{ width: `${Math.max(2, pct ?? 2)}%` }} />
          </span>
          <span className="block mt-1 text-caption text-label2 tabular">
            {pct == null ? 'Préparation…' : `${pct} % · ${formatBytes(loaded)} sur ${formatBytes(total)}`}
          </span>
        </span>
        <button type="button" className="w-11 h-11 flex-shrink-0 grid place-items-center rounded-full text-label2 hoverable"
          onClick={() => { cancelled = true; xhr.abort(); toast.dismiss(id) }} aria-label={`Annuler ${t.name}`} title="Annuler">
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>
    ), { id, duration: Infinity })
  }
  show(0, t.size ?? 0)
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      let shownAt = 0
      xhr.open('GET', t.url)
      xhr.responseType = 'blob'
      xhr.onprogress = (e) => {
        if (Date.now() - shownAt < 250) return
        shownAt = Date.now()
        show(e.loaded, e.lengthComputable ? e.total : t.size ?? 0)
      }
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.response as Blob) : reject(new Error(`Le serveur a répondu ${xhr.status}`)))
      xhr.onerror = () => reject(new Error('Connexion au serveur perdue'))
      xhr.onabort = () => reject(new DOMException('Annulé', 'AbortError'))
      xhr.send()
    })
    toast.dismiss(id)
    await share(new File([blob], t.name, { type }))
  } catch (err) {
    toast.dismiss(id)
    if (cancelled || (err as DOMException)?.name === 'AbortError') return
    showError('Téléchargement impossible', (err as Error)?.message || 'erreur inconnue')
  }
}

async function share(file: File): Promise<void> {
  try {
    await navigator.share({ files: [file] })
  } catch (err) {
    const name = (err as DOMException)?.name
    if (name === 'AbortError') return            // sheet closed
    if (name !== 'NotAllowedError') throw err
    // The tap's permission ran out while the file came: one more tap opens the sheet
    toast.custom((tt) => (
      <div role="status" className="flex items-center gap-3 p-3 pr-2.5 rounded-[22px] glass-strong w-[min(92vw,380px)] text-body"
        style={{ opacity: tt.visible ? 1 : 0, transition: 'opacity 200ms var(--ease-out)' }}>
        <ArrowDownToLine size={18} strokeWidth={1.75} className="flex-shrink-0 text-accent" aria-hidden="true" />
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-label truncate">{file.name}</span>
          <span className="block text-label2">Prêt · {formatBytes(file.size)}</span>
        </span>
        <Button variant="primary" className="font-semibold"
          onClick={() => { toast.dismiss(tt.id); void share(file).catch((e: Error) => showError('Enregistrement impossible', e.message)) }}>
          Enregistrer…
        </Button>
      </div>
    ), { id: `ready-${file.name}`, duration: 60_000 })
  }
}
