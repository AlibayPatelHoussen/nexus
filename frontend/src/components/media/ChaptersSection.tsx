import { useMemo, useState } from 'react'
import { ArrowDownToLine, BookOpen, ChevronsUpDown, CircleArrowDown, CircleCheck, RotateCw } from 'lucide-react'
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
  disableOffline, enableOffline, keepChapter, offlineSupported, releaseChapter, setOfflineCount, wantedChapters,
  type OfflineMedia,
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
        {sorted.map((c) => {
          const name = c.title || `Chapitre ${formatNumber(c.chapterNumber)}`
          const detail = [kindOf(c.folderPath), c.pageCount ? `${c.pageCount} p.` : null].filter(Boolean).join(' · ')
          return offline.supported ? (
            // The row reads the chapter; the button on its right keeps it on the device (or not)
            <div key={c.id} role="listitem" className="nx-row relative flex items-center min-h-row">
              <button type="button" className="flex-1 min-w-0 flex items-center gap-3 pl-4 pr-1 min-h-row text-left pressable hoverable"
                onClick={() => onRead(c.id, version ?? undefined)}>
                <span className="flex-1 min-w-0 truncate text-label py-[7px] max-md:py-[11px]">{name}</span>
                {detail && <span className="text-label2 tabular truncate max-w-[45%] text-right">{detail}</span>}
              </button>
              <OfflineButton name={name} state={offline.stateOf(c.id)} onKeep={() => offline.keep(c.id)} onRelease={() => offline.release(c.id)} />
            </div>
          ) : (
            <ListRow key={c.id} onClick={() => onRead(c.id, version ?? undefined)} title={name} detail={detail} accessory="chevron" />
          )
        })}
      </Group>
    </div>
  )
}

/* ── Offline reading (« Hors ligne », off by default) ─────────────────────── */

/** A chapter on this device: chosen by hand (stays) or kept by the switch (leaves once read) */
type MarkState = { kind: 'kept'; manual: boolean } | { kind: 'loading'; percent: number; manual: boolean } | { kind: 'waiting'; manual: boolean } | null

const COUNTS: { value: string; label: string }[] = [
  { value: '5', label: '5 chapitres' }, { value: '10', label: '10 chapitres' }, { value: '25', label: '25 chapitres' }, { value: 'all', label: 'Tous' },
]

function useOfflineOf(media: OfflineMedia, chapters: Chapter[]) {
  const { index, active, waiting } = useOfflineManga()
  const title = index.titles[media.id]
  const kept = Object.entries(index.chapters).filter(([, c]) => c.mediaId === media.id)
  const auto = title ? wantedChapters(chapters, title.count, title.version, index.lastRead[media.id]) : []
  const manualIds = new Set(chapters.filter((c) => index.manual[c.id] === media.id).map((c) => c.id))
  const wantedIds = new Set([...auto.map((c) => c.id), ...manualIds])
  const bytes = kept.reduce((s, [, c]) => s + c.bytes, 0)
  const activeHere = active?.mediaId === media.id ? active : null
  const error = waiting[media.id] ?? null
  return {
    supported: offlineSupported(),
    on: !!title,
    count: title?.count ?? 10,
    keptCount: kept.filter(([id]) => wantedIds.has(id)).length,
    wantedCount: wantedIds.size,
    manualCount: manualIds.size,
    bytes,
    active: activeHere,
    busy: media.id in waiting && !error,
    error,
    stateOf(chapterId: string): MarkState {
      const manual = manualIds.has(chapterId)
      if (index.chapters[chapterId]?.mediaId === media.id) return { kind: 'kept', manual }
      if (activeHere?.chapterId === chapterId) return { kind: 'loading', percent: activeHere.total ? (activeHere.done / activeHere.total) * 100 : 0, manual }
      return wantedIds.has(chapterId) ? { kind: 'waiting', manual } : null
    },
    keep: (chapterId: string) => { void keepChapter({ ...media, chapters }, chapterId) },
    release: (chapterId: string) => { void releaseChapter(media.id, chapterId).then(() => toast.success('Chapitre retiré de cet appareil')) },
    toggle(on: boolean, version: string | null) {
      if (on) void enableOffline({ ...media, chapters }, title?.count ?? 10, version)
      else void disableOffline(media.id).then(() => toast.success('Chapitres retirés de cet appareil'))
    },
    setCount: (count: OfflineCount) => setOfflineCount(media.id, count),
  }
}

function OfflineGroup({ offline, onSwitch, phone }: { offline: ReturnType<typeof useOfflineOf>; onSwitch: (on: boolean) => void; phone: boolean }) {
  const { on, active, keptCount, wantedCount, bytes, error, busy, manualCount } = offline
  const n = (k: number) => `${k} chapitre${k > 1 ? 's' : ''}`
  const status = !on && !wantedCount ? 'Rien n’est gardé'
    : !on && !active && !busy && keptCount ? `${n(keptCount)} choisi${keptCount > 1 ? 's' : ''} · ${formatBytes(bytes)}`
    : active ? `Téléchargement… ${keptCount + 1} sur ${wantedCount} · ${Math.floor(active.total ? (active.done / active.total) * 100 : 0)} %`
    : error ? `${error} · ${keptCount} sur ${wantedCount}`
    : busy && keptCount < wantedCount ? `Préparation… ${keptCount} sur ${wantedCount}`
    : keptCount ? `${n(keptCount)} · ${formatBytes(bytes)}`
    : 'Aucun chapitre à garder'
  const countLabel = COUNTS.find((c) => c.value === String(offline.count))?.label ?? ''
  return (
    <Group className="mb-4"
      footer={`${on
        ? 'Les chapitres à partir de celui que tu lis restent sur cet appareil pour les lire sans connexion ; ceux que tu as lus sont retirés pour libérer la place.'
        : 'Active-le pour lire les prochains chapitres sans connexion (dans le métro, en avion…).'} ${manualCount
        ? 'Les chapitres choisis avec ↓ restent jusqu’à ce que tu les retires.'
        : 'Ou garde un chapitre précis avec ↓ sur sa ligne : il reste jusqu’à ce que tu le retires.'}`}>
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

/**
 * On a chapter's right (Podcasts-like): ↓ keeps it on this device; ✓ chosen by hand (tap: removes it);
 * the grey arrow, kept by the switch (tap: keeps it after reading too); a ring while it downloads.
 */
function OfflineButton({ name, state, onKeep, onRelease }: { name: string; state: MarkState; onKeep: () => void; onRelease: () => void }) {
  const btn = 'w-11 h-11 mr-1 flex-shrink-0 grid place-items-center rounded-full hoverable pressable'
  if (!state) {
    return (
      <button type="button" className={cn(btn, 'text-accent-text')} onClick={onKeep} aria-label={`Garder « ${name} » hors ligne`} title="Garder hors ligne">
        <CircleArrowDown size={20} strokeWidth={1.75} />
      </button>
    )
  }
  if (state.kind === 'kept') {
    return state.manual ? (
      <button type="button" className={cn(btn, 'text-accent-text')} onClick={onRelease} aria-label={`« ${name} » est sur l’appareil : le retirer`} title="Retirer de l’appareil">
        <CircleCheck size={20} strokeWidth={1.75} />
      </button>
    ) : (
      <button type="button" className={cn(btn, 'text-label2')} onClick={onKeep} aria-label={`« ${name} » est sur l’appareil (Hors ligne) : le garder même lu`} title="Garder même après l’avoir lu">
        <CircleArrowDown size={20} strokeWidth={1.75} />
      </button>
    )
  }
  const r = 8
  const c = 2 * Math.PI * r
  const pct = state.kind === 'loading' ? state.percent : 0
  const label = state.kind === 'loading' ? `Téléchargement de « ${name} » : ${Math.floor(pct)} %` : `« ${name} » attend son téléchargement`
  const ring = (
    <svg width="20" height="20" viewBox="0 0 20 20" className="-rotate-90" aria-hidden="true">
      <circle cx="10" cy="10" r={r} fill="none" stroke="var(--fill)" strokeWidth="2" />
      {pct > 0 && <circle cx="10" cy="10" r={r} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} className="transition-[stroke-dashoffset] duration-slow ease-out" />}
    </svg>
  )
  // Chosen by hand: a tap cancels it; kept by the switch: only shown
  return state.manual ? (
    <button type="button" className={btn} onClick={onRelease} aria-label={`${label} — annuler`} title="Annuler">{ring}</button>
  ) : (
    <span className={cn(btn, 'pointer-events-none')} role="img" aria-label={label}>{ring}</span>
  )
}
