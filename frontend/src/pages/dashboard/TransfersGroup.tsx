import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownToLine, ArrowUpFromLine, Ellipsis, Eye, File, FileArchive, FileAudio, FileImage, FileText, FileVideo, Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Group, ListRow } from '@/components/ui/GroupedList'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useConfirm } from '@/components/ui/useConfirm'
import { useContextMenu } from '@/components/ui/useContextMenu'
import type { MenuItem } from '@/components/ui/ContextMenu'
import UploadRows from '@/components/files/UploadRows'
import { useFileDrop, useUploads } from '@/hooks/useUploads'
import { useTransfersSocket } from '@/hooks/useTransfersSocket'
import { getStreamToken } from '@/services/streamToken'
import { isPreviewable, transfersService, type Transfer } from '@/services/transfersService'
import { serverError, showError } from '@/utils/errorToast'
import { cn, formatBytes, formatWhen } from '@/utils'

/**
 * Aperçu › Transferts (admins): send a file from this device, take it on another one
 * (iPhone → computer and back), instead of a separate file-sharing app. Files arrive live on
 * the account's other open pages (and as a notification), and are erased after a few days.
 */
export default function TransfersGroup({ phone }: { phone: boolean }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const menu = useContextMenu()
  const { hash } = useLocation()
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useTransfersSocket()
  const { data: items, isError } = useQuery({ queryKey: ['transfers'], queryFn: transfersService.list })
  const { data: token } = useQuery({ queryKey: ['stream-token'], queryFn: getStreamToken, staleTime: 30 * 60_000 })
  const { jobs, run, cancel } = useUploads()

  // From the notification / the toast (/dashboard#transferts)
  useEffect(() => {
    if (hash === '#transferts') box.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [hash])

  async function send(files: File[]) {
    if (!files.length) return
    try {
      const added = await run(files, (progress, signal) => transfersService.send(files, progress, signal))
      if (added) {
        qc.setQueryData<Transfer[]>(['transfers'], (list) => [...added, ...(list ?? []).filter((t) => !added.some((a) => a.id === t.id))])
        toast.success(added.length > 1 ? `${added.length} fichiers envoyés` : `« ${added[0].name} » envoyé`)
      }
    } catch (err) { showError('Envoi impossible', serverError(err)) }
  }
  const { over, handlers } = useFileDrop((files, folders) => {
    if (folders) toast(`Les dossiers ne s’envoient pas ici : ouvre-les et choisis leurs fichiers${files.length ? ' (les fichiers sont envoyés)' : ''}.`)
    void send(files)
  }, !phone)

  const remove = useMutation({
    mutationFn: (id: string) => transfersService.remove(id),
    onSuccess: (_d, id) => qc.setQueryData<Transfer[]>(['transfers'], (list) => list?.filter((t) => t.id !== id)),
    onError: (err) => showError('Suppression impossible', serverError(err)),
  })
  async function clearAll() {
    const n = items?.length ?? 0
    const ok = await confirm({
      title: 'Tout effacer ?',
      message: `${n > 1 ? `Les ${n} fichiers sont effacés` : 'Le fichier est effacé'} du serveur, sur tous tes appareils.`,
      confirmLabel: 'Tout effacer',
      danger: true,
    })
    if (!ok) return
    try { await transfersService.clear(); qc.setQueryData<Transfer[]>(['transfers'], []) }
    catch (err) { showError('Suppression impossible', serverError(err)) }
  }

  const url = (t: Transfer, inline = false) => (token ? transfersService.fileUrl(t.id, token, inline) : undefined)
  const itemsFor = (t: Transfer): MenuItem[] => [
    { label: 'Télécharger', icon: <ArrowDownToLine />, onSelect: () => download(t) },
    ...(isPreviewable(t) ? [{ label: 'Ouvrir', icon: <Eye />, onSelect: () => { const u = url(t, true); if (u) window.open(u, '_blank', 'noopener') } }] : []),
    { separator: true },
    { label: 'Supprimer', icon: <Trash2 />, destructive: true, onSelect: () => remove.mutate(t.id) },
  ]
  function download(t: Transfer) {
    const u = url(t)
    if (!u) return
    const a = document.createElement('a')
    a.href = u
    a.download = t.name
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const days = items?.[0] ? Math.max(1, Math.round((Date.parse(items[0].expiresAt) - Date.parse(items[0].createdAt)) / 86_400_000)) : 7
  const footer = `Ce que tu envoies ici arrive sur tes autres appareils (connectés à ce compte) et s’efface du serveur après ${days} jour${days > 1 ? 's' : ''}.`

  return (
    <div ref={box} id="transferts" className="relative scroll-mt-24 min-w-0" {...handlers}>
      <Group
        header="Transferts"
        id="transfers"
        action={items && items.length > 1 ? <button type="button" className="text-subhead text-accent-text hover:underline" onClick={clearAll}>Tout effacer</button> : undefined}
        footer={footer}
      >
        <ListRow
          icon={<ArrowUpFromLine strokeWidth={1.75} />}
          iconTone="accent"
          title="Envoyer des fichiers"
          subtitle={phone ? 'Photos, vidéos, documents…' : 'Ou dépose-les ici'}
          onClick={() => input.current?.click()}
        />
        <UploadRows jobs={jobs} onCancel={cancel} />
        {isError ? (
          <ListRow title="Liste indisponible" subtitle="Le serveur n’a pas répondu. Réessaie dans un instant." />
        ) : !items ? (
          <SkeletonRows rows={2} />
        ) : items.map((t) => (
          <TransferRow key={t.id} t={t} preview={isPreviewable(t) ? url(t, true) : undefined} href={url(t)}
            bind={menu.bind(itemsFor(t), t.name)}
            onMore={(el) => menu.openFrom(el, itemsFor(t), t.name)} />
        ))}
      </Group>
      {over && (
        <div className="absolute inset-0 z-10 rounded-group border-2 border-dashed border-accent bg-accent-soft grid place-items-center pointer-events-none" aria-hidden="true">
          <span className="flex items-center gap-2 text-headline text-accent-text font-semibold">
            <ArrowUpFromLine size={20} strokeWidth={1.75} /> Dépose pour envoyer
          </span>
        </div>
      )}
      {menu.element}
      <input ref={input} type="file" multiple className="hidden" aria-hidden="true" tabIndex={-1}
        onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void send(f) }} />
    </div>
  )
}

function iconFor(t: Transfer) {
  const m = t.mime ?? ''
  const ext = t.name.split('.').pop()?.toLowerCase() ?? ''
  if (m.startsWith('image/')) return FileImage
  if (m.startsWith('video/') || ['mkv', 'mp4', 'mov', 'avi', 'webm'].includes(ext)) return FileVideo
  if (m.startsWith('audio/')) return FileAudio
  if (['zip', 'rar', '7z', 'tar', 'gz', 'cbz'].includes(ext)) return FileArchive
  if (m.startsWith('text/') || ['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) return FileText
  return File
}

function TransferRow({ t, preview, href, bind, onMore }: {
  t: Transfer
  preview?: string
  href?: string
  bind: ReturnType<ReturnType<typeof useContextMenu>['bind']>
  onMore: (el: HTMLElement) => void
}) {
  const Icon = iconFor(t)
  const [broken, setBroken] = useState(false)
  // « iPhone » from « iPhone · Safari »
  const device = t.device?.split(' · ')[0]
  const detail = [formatBytes(t.size), device, formatWhen(t.createdAt)].filter(Boolean).join(' · ')
  return (
    <div role="listitem" className="nx-row relative flex items-center gap-3 pl-4 pr-2 min-h-row" {...bind}>
      <a href={href} download={t.name} className={cn('flex-1 min-w-0 flex items-center gap-3 py-[7px] max-md:py-[9px] rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent', !href && 'pointer-events-none')}
        aria-label={`Télécharger ${t.name}, ${detail}`}>
        <span className="w-9 h-9 flex-shrink-0 rounded-[8px] bg-fill overflow-hidden grid place-items-center text-label2" aria-hidden="true">
          {preview && !broken
            ? <img src={preview} alt="" loading="lazy" className="w-full h-full object-cover" onError={() => setBroken(true)} />
            : <Icon size={18} strokeWidth={1.5} />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block truncate text-label">{t.name}</span>
          <span className="block truncate text-subhead text-label2 tabular mt-px">{detail}</span>
        </span>
        <ArrowDownToLine size={18} strokeWidth={1.75} className="flex-shrink-0 text-accent-text" aria-hidden="true" />
      </a>
      <button type="button" className="w-11 h-11 flex-shrink-0 grid place-items-center rounded-full text-label2 hoverable"
        onClick={(e) => onMore(e.currentTarget)} aria-haspopup="menu" aria-label={`Options pour ${t.name}`}>
        <Ellipsis size={18} strokeWidth={1.75} />
      </button>
    </div>
  )
}
