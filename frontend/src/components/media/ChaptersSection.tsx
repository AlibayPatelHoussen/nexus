import { useMemo, useState } from 'react'
import { ArrowDownToLine, BookOpen, ChevronRight, ChevronsUpDown, CircleArrowDown, RotateCw } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Chapter } from '@/types'
import { Group, ListRow } from '@/components/ui/GroupedList'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import SegmentedControl from '@/components/ui/SegmentedControl'
import Toggle from '@/components/ui/Toggle'
import PullDownMenu from '@/components/ui/PullDownMenu'
import { useShell } from '@/components/shell/shellContext'
import { useOfflineManga } from '@/hooks/useOfflineManga'
import {
  disableOffline, enableOffline, offlineSupported, setOfflineCount, wantedChapters, type OfflineMedia,
} from '@/services/offlineManga'
import type { OfflineCount } from '@/services/offlineIndex'
import { cn, formatBytes } from '@/utils'
import { chapterVersions, versionName } from './chapterVersions'

interface Props {
  /** The title (kept as is for reading offline) */
  media:     OfflineMedia
  chapters:  Chapter[]
  /** version = the folder the chapter is in (« VF », « VF Noir et blanc »), for the reader */
  onRead:    (chapterId: string, version?: string) => void
  onScan:    () => void
  scanning:  boolean
}

const formatNumber = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }))

function kindOf(path: string): 'PDF' | 'CBZ' | null {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'PDF'
  if (ext === 'cbz' || ext === 'zip') return 'CBZ'
  return null
}

/** Chapters of a manga: sorted by number, click to read; clear empty state.
 *  Several versions (VF / VOSTFR, colour / black & white): one at a time, chosen on top. */
export default function ChaptersSection({ media, chapters, onRead, onScan, scanning }: Props) {
  const [desc, setDesc] = useState(false)
  const phone = useShell().device === 'phone'
  const versions = useMemo(() => chapterVersions(chapters), [chapters])
  const [picked, setPicked] = useState<string | null>(null)
  const version = picked && versions.includes(picked) ? picked : versions[0] ?? null
  const shown = useMemo(() => (version ? chapters.filter((c) => c.language === version) : chapters), [chapters, version])
  const sorted = useMemo(
    () => [...shown].sort((a, b) => (desc ? -1 : 1) * (a.chapterNumber - b.chapterNumber || a.folderPath.localeCompare(b.folderPath, undefined, { numeric: true }))),
    [shown, desc],
  )

  const offline = useOfflineOf(media, chapters)

  if (chapters.length === 0) {
    return (
      <section className="bg-surface rounded-card mb-10">
        <EmptyState
          icon={<BookOpen strokeWidth={1.25} />}
          title="Aucun chapitre trouvé"
          message={<>Range les chapitres dans le dossier du manga : un dossier d’images par chapitre, ou des fichiers <span className="font-mono">.pdf</span> / <span className="font-mono">.cbz</span>. Lance ensuite une analyse.</>}
          action={<Button variant="primary" icon={<RotateCw size={14} strokeWidth={1.75} />} loading={scanning} onClick={onScan}>Analyser les chapitres</Button>}
        />
      </section>
    )
  }

  return (
    <div className="mb-10">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-title text-label">Chapitres</h2>
          <p className="text-subhead text-label2 mt-0.5 tabular">{shown.length} chapitre{shown.length > 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="plain" onClick={() => setDesc((d) => !d)} aria-label={desc ? 'Trier du premier au dernier' : 'Trier du dernier au premier'}>
            {desc ? 'Du plus récent' : 'Dans l’ordre'}
          </Button>
          <Button variant="primary" icon={<BookOpen size={14} strokeWidth={1.75} />} onClick={() => onRead(sorted[desc ? sorted.length - 1 : 0].id, version ?? undefined)}>
            Commencer
          </Button>
        </div>
      </div>
      {versions.length > 1 && (
        <SegmentedControl label="Version" value={version ?? ''} onChange={setPicked} full={phone} className="mb-3"
          options={versions.map((v) => ({ value: v, label: versionName(v, versions) }))} />
      )}
      {offline.supported && <OfflineGroup offline={offline} onSwitch={(on) => offline.toggle(on, version)} phone={phone} />}
      <Group>
        {sorted.map((c) => (
          <ListRow
            key={c.id}
            onClick={() => onRead(c.id, version ?? undefined)}
            title={c.title || `Chapitre ${formatNumber(c.chapterNumber)}`}
            detail={[kindOf(c.folderPath), c.pageCount ? `${c.pageCount} p.` : null].filter(Boolean).join(' · ')}
            accessory={<span className="flex items-center gap-2 -mr-1"><OfflineMark state={offline.stateOf(c.id)} /><ChevronRight className="flex-shrink-0 text-label3" size={16} strokeWidth={2} aria-hidden="true" /></span>}
          />
        ))}
      </Group>
    </div>
  )
}

/* ── Offline reading (« Hors ligne », off by default) ─────────────────────── */

type MarkState = { kind: 'kept' } | { kind: 'loading'; percent: number } | { kind: 'waiting' } | null

const COUNTS: { value: string; label: string }[] = [
  { value: '5', label: '5 chapitres' }, { value: '10', label: '10 chapitres' }, { value: '25', label: '25 chapitres' }, { value: 'all', label: 'Tous' },
]

function useOfflineOf(media: OfflineMedia, chapters: Chapter[]) {
  const { index, active, waiting } = useOfflineManga()
  const title = index.titles[media.id]
  const kept = Object.entries(index.chapters).filter(([, c]) => c.mediaId === media.id)
  const wanted = title ? wantedChapters(chapters, title.count, title.version, index.lastRead[media.id]) : []
  const wantedIds = new Set(wanted.map((c) => c.id))
  const bytes = kept.reduce((s, [, c]) => s + c.bytes, 0)
  const activeHere = active?.mediaId === media.id ? active : null
  const error = waiting[media.id] ?? null
  return {
    supported: offlineSupported(),
    on: !!title,
    count: title?.count ?? 10,
    keptCount: kept.filter(([id]) => wantedIds.has(id)).length,
    wantedCount: wanted.length,
    bytes,
    active: activeHere,
    busy: media.id in waiting && !error,
    error,
    stateOf(chapterId: string): MarkState {
      if (index.chapters[chapterId]?.mediaId === media.id) return { kind: 'kept' }
      if (activeHere?.chapterId === chapterId) return { kind: 'loading', percent: activeHere.total ? (activeHere.done / activeHere.total) * 100 : 0 }
      return title && wantedIds.has(chapterId) ? { kind: 'waiting' } : null
    },
    toggle(on: boolean, version: string | null) {
      if (on) void enableOffline({ ...media, chapters }, title?.count ?? 10, version)
      else void disableOffline(media.id).then(() => toast.success('Chapitres retirés de cet appareil'))
    },
    setCount: (count: OfflineCount) => setOfflineCount(media.id, count),
  }
}

function OfflineGroup({ offline, onSwitch, phone }: { offline: ReturnType<typeof useOfflineOf>; onSwitch: (on: boolean) => void; phone: boolean }) {
  const { on, active, keptCount, wantedCount, bytes, error, busy } = offline
  const n = (k: number) => `${k} chapitre${k > 1 ? 's' : ''}`
  const status = !on ? 'Rien n’est gardé'
    : active ? `Téléchargement… ${keptCount + 1} sur ${wantedCount} · ${Math.floor(active.total ? (active.done / active.total) * 100 : 0)} %`
    : error ? `${error} · ${keptCount} sur ${wantedCount}`
    : busy && keptCount < wantedCount ? `Préparation… ${keptCount} sur ${wantedCount}`
    : keptCount ? `${n(keptCount)} · ${formatBytes(bytes)}`
    : 'Aucun chapitre à garder'
  const countLabel = COUNTS.find((c) => c.value === String(offline.count))?.label ?? ''
  return (
    <Group className="mb-4"
      footer={on
        ? 'Les chapitres à partir de celui que tu lis restent sur cet appareil pour les lire sans connexion ; ceux que tu as lus sont retirés pour libérer la place.'
        : 'Active-le pour lire les prochains chapitres sans connexion (dans le métro, en avion…).'}>
      <ListRow
        icon={<ArrowDownToLine strokeWidth={1.75} />}
        iconTone="green"
        title="Hors ligne"
        subtitle={<span className="tabular" aria-live="polite">{status}</span>}
        wrap
        accessory={<Toggle checked={on} onChange={onSwitch} label="Garder des chapitres pour les lire hors ligne" />}
      />
      {on && (
        // iOS 26 pop-up button: the value, a menu with a checkmark
        <ListRow title="À garder">
          <PullDownMenu label="Chapitres à garder" value={String(offline.count)} options={COUNTS}
            onChange={(v) => offline.setCount(v === 'all' ? 'all' : (Number(v) as OfflineCount))}
            className={cn('flex items-center gap-1 -mr-1.5 px-1.5 min-h-[44px] rounded-[8px] text-label2 hoverable', !phone && 'min-h-[28px]')}>
            {countLabel}
            <ChevronsUpDown size={phone ? 16 : 13} strokeWidth={2} aria-hidden="true" />
          </PullDownMenu>
        </ListRow>
      )}
    </Group>
  )
}

/** Next to a chapter: kept (arrow in a circle), downloading (a ring filling up), waiting (empty ring) */
function OfflineMark({ state }: { state: MarkState }) {
  if (!state) return null
  if (state.kind === 'kept') return <CircleArrowDown size={16} strokeWidth={1.75} className="flex-shrink-0 text-label2" aria-label="Disponible hors ligne" role="img" />
  const r = 6.5
  const c = 2 * Math.PI * r
  const pct = state.kind === 'loading' ? state.percent : 0
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="flex-shrink-0 -rotate-90" role="img"
      aria-label={state.kind === 'loading' ? `Téléchargement ${Math.floor(pct)} %` : 'En attente de téléchargement'}>
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--fill)" strokeWidth="2" />
      {pct > 0 && <circle cx="8" cy="8" r={r} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} className="transition-[stroke-dashoffset] duration-slow ease-out" />}
    </svg>
  )
}
