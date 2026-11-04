import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { AlertTriangle, Download as DownloadIcon, MoreHorizontal, Pause, Play, RotateCw, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { SOURCE_INFO, downloadsService, type Download } from '@/services/downloadsService'
import { useShell } from '@/components/shell/shellContext'
import { Group } from '@/components/ui/GroupedList'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useContextMenu } from '@/components/ui/useContextMenu'
import type { MenuItem } from '@/components/ui/ContextMenu'
import Artwork from '@/components/media/Artwork'
import KindBadge from '@/components/downloads/KindBadge'
import { cn } from '@/utils'

type Action = 'pause' | 'resume' | 'cancel' | 'retry' | 'delete' | 'open'

/** "Saison 1 · VOSTFR · épisodes 1–12" */
export function describe(d: Download): string {
  const parts: string[] = []
  const season = d.options.season
  if (season) parts.push(/^\d+$/.test(season) ? `Saison ${season}` : season.replace(/^saison(\d+)/, 'Saison $1').replace(/^(\w)/, (c) => c.toUpperCase()))
  if (d.options.part) parts.push(d.options.part)                 // oxtorrent: « S01E03 »
  if (d.options.version?.label) parts.push(d.options.version.label)   // oxtorrent: « 1080p MULTI »
  if (d.options.lang) parts.push(d.options.lang)
  const list = d.selection.episodes ?? d.selection.chapters
  if (list?.length) {
    const noun = d.selection.chapters ? 'chapitre' : 'épisode'
    const sorted = [...list].sort((a, b) => a - b)
    const contiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1)
    parts.push(sorted.length === 1 ? `${noun} ${sorted[0]}`
      : contiguous ? `${noun}s ${sorted[0]}–${sorted[sorted.length - 1]}` : `${sorted.length} ${noun}s`)
  }
  return parts.join(' · ')
}

function ProgressLine({ d }: { d: Download }) {
  const p = d.progress
  const manga = d.kind === 'manga'
  let percent: number | null = null
  let text = ''
  if (d.status === 'running') {
    if (manga && p.pages_total) {
      const chapters = p.chapters_total || p.total || 1
      const idx = (p.chapter || p.index || 1) - 1
      percent = ((idx + (p.page || 0) / p.pages_total) / chapters) * 100
      text = `Chapitre ${p.chapter ?? p.index}/${chapters} · page ${p.page}/${p.pages_total}`
    } else if (p.percent != null) {
      const items = p.total && p.total > 1 ? ((p.index || 1) - 1 + p.percent / 100) / p.total * 100 : p.percent
      percent = items
      const mb = p.downloaded_mb != null ? `${Math.round(p.downloaded_mb)}${p.total_mb ? `/${Math.round(p.total_mb)}` : ''} Mo` : ''
      text = [p.total && p.total > 1 ? `${p.item} (${p.index}/${p.total})` : p.item, mb, p.speed, p.eta && `${p.eta} restantes`].filter(Boolean).join(' · ')
    } else {
      text = p.item ? `${p.item} · préparation…` : 'Préparation…'
    }
  }
  return (
    <div className="mt-1.5">
      <div className="h-[4px] rounded-full bg-fill overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={percent != null ? Math.round(percent) : undefined} aria-label="Progression">
        <div className={cn('h-full rounded-full bg-accent transition-[width] duration-slow ease-out', percent == null && 'w-1/3 animate-pulse')}
          style={percent != null ? { width: `${Math.min(100, Math.max(2, percent))}%` } : undefined} />
      </div>
      {text && <p className="mt-1 text-caption text-label2 tabular truncate">{text}</p>}
    </div>
  )
}

function statusText(d: Download): React.ReactNode {
  switch (d.status) {
    case 'queued': return 'En attente'
    case 'paused': return 'En pause'
    case 'cancelled': return 'Annulé'
    case 'failed': return <span className="text-danger-text">{d.error || 'Échec'}</span>
    case 'done': {
      const r = d.progress.result
      const n = (r?.ok ?? d.progress.items_done ?? 0)
      const s = r?.skipped ?? d.progress.items_skipped ?? 0
      return [n ? `${n} téléchargé${n > 1 ? 's' : ''}` : null, s ? `${s} déjà présent${s > 1 ? 's' : ''}` : null, d.error].filter(Boolean).join(' · ') || 'Terminé'
    }
    default: return null
  }
}

function actionsFor(d: Download): Action[] {
  switch (d.status) {
    case 'running': return ['pause', 'cancel']
    case 'queued': return ['pause', 'cancel']
    case 'paused': return ['resume', 'cancel']
    case 'done': return ['open', 'retry', 'delete']
    case 'failed': case 'cancelled': return ['retry', 'delete']
  }
}

const ACTION_META: Record<Action, { label: string; icon: React.ReactNode; tone: string; destructive?: boolean }> = {
  open:   { label: 'Ouvrir',     icon: <Play size={16} />,      tone: 'var(--accent-fill)' },
  pause:  { label: 'Pause',      icon: <Pause size={16} />,     tone: 'var(--orange)' },
  resume: { label: 'Reprendre',  icon: <Play size={16} />,      tone: 'var(--green)' },
  retry:  { label: 'Relancer',   icon: <RotateCw size={16} />,  tone: 'var(--accent-fill)' },
  cancel: { label: 'Annuler',    icon: <X size={16} />,         tone: 'var(--red)', destructive: true },
  delete: { label: 'Retirer',    icon: <Trash2 size={16} />,    tone: 'var(--red)', destructive: true },
}

/** iOS list row: swipe left to reveal the actions. */
function SwipeRow({ actions, onAction, children }: { actions: Action[]; onAction: (a: Action) => void; children: React.ReactNode }) {
  const WIDTH = 76 * actions.length
  const [x, setX] = useState(0)
  const [drag, setDrag] = useState(false)
  const start = useRef<{ x: number; y: number; base: number; locked: boolean | null } | null>(null)
  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-y-0 right-0 flex" style={{ width: WIDTH, visibility: x === 0 && !drag ? 'hidden' : 'visible' }} aria-hidden={x === 0}>
        {actions.map((a) => (
          <button key={a} type="button" tabIndex={x === 0 ? -1 : 0} onClick={() => { setX(0); onAction(a) }}
            className="no-press flex-1 flex flex-col items-center justify-center gap-1 text-white text-[12px] font-medium"
            style={{ background: ACTION_META[a].tone }}>
            {ACTION_META[a].icon}{ACTION_META[a].label}
          </button>
        ))}
      </div>
      <div
        className="relative bg-surface"
        style={{ transform: `translateX(${x}px)`, transition: drag ? 'none' : 'transform 300ms var(--ease-sheet)', touchAction: 'pan-y' }}
        onTouchStart={(e) => { const t = e.touches[0]; start.current = { x: t.clientX, y: t.clientY, base: x, locked: null } }}
        onTouchMove={(e) => {
          const s = start.current; if (!s) return
          const t = e.touches[0]; const dx = t.clientX - s.x; const dy = t.clientY - s.y
          if (s.locked === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) s.locked = Math.abs(dx) > Math.abs(dy)
          if (!s.locked) return
          setDrag(true)
          setX(Math.min(0, Math.max(-WIDTH - 30, s.base + dx)))
        }}
        onTouchEnd={() => { setDrag(false); setX((v) => (v < -WIDTH / 2 ? -WIDTH : 0)); start.current = null }}
        onClick={() => { if (x !== 0) setX(0) }}
      >
        {children}
      </div>
    </div>
  )
}

function Row({ d, onAction }: { d: Download; onAction: (d: Download, a: Action) => void }) {
  const { device } = useShell()
  const phone = device === 'phone'
  const menu = useContextMenu()
  const actions = actionsFor(d)
  const items: MenuItem[] = actions.map((a) => ({
    label: ACTION_META[a].label, icon: ACTION_META[a].icon, destructive: ACTION_META[a].destructive, onSelect: () => onAction(d, a),
  }))
  const video = d.kind === 'youtube'
  const content = (
    <div role="listitem" className="nx-row nx-row-inset relative flex items-center gap-3 px-4 py-2.5" {...(!phone ? menu.bind(items, d.title) : {})}>
      <Artwork src={d.poster_url} alt="" ratio={video ? '16 / 9' : '2 / 3'} type={d.kind} cover={video}
        className={cn('flex-shrink-0 rounded-[5px]', video ? 'w-[72px]' : 'w-[40px]')} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('truncate text-label', phone ? 'text-[17px]' : 'text-body font-medium')}>{d.title}</span>
          <KindBadge kind={d.kind} className="flex-shrink-0" />
        </div>
        <p className="text-subhead text-label2 truncate">{[describe(d) || (video ? 'Vidéo' : 'Film'), SOURCE_INFO[d.source_script]?.site].filter(Boolean).join(' · ')}</p>
        {d.status === 'running' ? <ProgressLine d={d} /> : <p className="text-caption text-label2 truncate mt-0.5">{statusText(d)}</p>}
      </div>
      {!phone && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {d.status === 'done' && <Button size="small" variant="secondary" onClick={() => onAction(d, 'open')}>Ouvrir</Button>}
          {d.status === 'running' && <IconButton label="Pause" onClick={() => onAction(d, 'pause')}><Pause size={15} /></IconButton>}
          {d.status === 'paused' && <IconButton label="Reprendre" onClick={() => onAction(d, 'resume')}><Play size={15} /></IconButton>}
          {(d.status === 'failed' || d.status === 'cancelled') && <IconButton label="Relancer" onClick={() => onAction(d, 'retry')}><RotateCw size={15} /></IconButton>}
          <IconButton label="Plus d’actions" onClick={(e) => menu.openFrom(e.currentTarget, items, d.title)}><MoreHorizontal size={16} /></IconButton>
        </div>
      )}
      {phone && d.status === 'done' && (
        <button type="button" className="flex-shrink-0 h-8 px-3 rounded-full bg-fill text-accent-text text-subhead font-semibold" onClick={() => onAction(d, 'open')}>Ouvrir</button>
      )}
      {menu.element}
    </div>
  )
  return phone ? <SwipeRow actions={actions.filter((a) => a !== 'open')} onAction={(a) => onAction(d, a)}>{content}</SwipeRow> : content
}

function IconButton({ label, onClick, children }: { label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className="w-8 h-8 grid place-items-center rounded-full text-label2 hoverable">{children}</button>
  )
}

export default function QueueView({ onSearch }: { onSearch: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['downloads'], queryFn: downloadsService.list, refetchInterval: 30_000 })

  async function onAction(d: Download, a: Action) {
    try {
      if (a === 'open') {
        const t = await downloadsService.open(d.id)
        if (t.reader === 'reader') navigate(`/reader/${t.mediaId}${t.chapterId ? `?ch=${t.chapterId}` : ''}`)
        else navigate(`/player/${t.mediaId}${t.episodeId ? `?ep=${t.episodeId}` : ''}`)
        return
      }
      if (a === 'delete') {
        await downloadsService.remove(d.id)
        qc.setQueryData<Download[]>(['downloads'], (l) => l?.filter((x) => x.id !== d.id))
        return
      }
      const row = await downloadsService.act(d.id, a)
      qc.setQueryData<Download[]>(['downloads'], (l) => l?.map((x) => (x.id === row.id ? row : x)))
    } catch (err) {
      toast.error(isAxiosError(err) ? err.response?.data?.error ?? 'Action impossible.' : 'Action impossible.')
    }
  }

  if (isLoading) return <SkeletonRows rows={4} />
  if (isError) {
    return <EmptyState tone="error" icon={<AlertTriangle strokeWidth={1.25} />} title="File indisponible"
      message="Le serveur n’a pas répondu." action={<Button size="small" onClick={() => refetch()}>Réessayer</Button>} />
  }
  const list = data ?? []
  if (!list.length) {
    return <EmptyState icon={<DownloadIcon strokeWidth={1.25} />} title="Aucun téléchargement"
      message="Ce que tu télécharges apparaîtra ici, avec sa progression." action={<Button size="small" variant="primary" onClick={onSearch}>Rechercher</Button>} />
  }
  const sections: { title: string; items: Download[] }[] = [
    { title: 'En cours', items: list.filter((d) => d.status === 'running') },
    { title: 'En attente', items: list.filter((d) => d.status === 'queued' || d.status === 'paused') },
    { title: 'Terminés', items: list.filter((d) => d.status === 'done') },
    { title: 'Échecs', items: list.filter((d) => d.status === 'failed' || d.status === 'cancelled') },
  ]
  return (
    <div className="flex flex-col gap-7 max-w-[860px]">
      {sections.filter((s) => s.items.length).map((s) => (
        <Group key={s.title} header={`${s.title} (${s.items.length})`}>
          {s.items.map((d) => <Row key={d.id} d={d} onAction={onAction} />)}
        </Group>
      ))}
    </div>
  )
}
