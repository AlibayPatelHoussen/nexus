import { useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, BookOpen, Check, CheckCheck, ChevronsUpDown, CircleArrowDown, CircleCheck, Circle, ListChecks, RotateCw } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Chapter } from '@/types'
import { Group, ListRow } from '@/components/ui/GroupedList'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import SegmentedControl from '@/components/ui/SegmentedControl'
import Toggle from '@/components/ui/Toggle'
import PullDownMenu from '@/components/ui/PullDownMenu'
import SelectionBar from '@/components/ui/SelectionBar'
import { useContextMenu } from '@/components/ui/useContextMenu'
import type { MenuItem } from '@/components/ui/ContextMenu'
import { useShell } from '@/components/shell/shellContext'
import { useOfflineManga } from '@/hooks/useOfflineManga'
import {
  disableOffline, enableOffline, keepChapter, offlineSupported, releaseChapter, setOfflineCount, wantedChapters,
  type OfflineMedia,
} from '@/services/offlineManga'
import type { OfflineCount } from '@/services/offlineIndex'
import { cn, formatBytes } from '@/utils'
import { chapterVersions, versionName } from './chapterVersions'
import type { ReadingState } from './readingState'

interface Props {
  /** The title (kept as is for reading offline) */
  media:     OfflineMedia
  chapters:  Chapter[]
  /** What this account read (title page: readingState) */
  reading:   ReadingState
  /** version = the folder the chapter is in (« VF », « VF Noir et blanc »), for the reader; page = where it was left */
  onRead:    (chapterId: string, version?: string, page?: number) => void
  /** « Marquer comme lu / non lu » */
  onMark:    (chapterIds: string[], read: boolean) => Promise<void>
  onScan:    () => void
  scanning:  boolean
}

const formatNumber = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }))
const chaptersWord = (n: number) => `${n} chapitre${n > 1 ? 's' : ''}`

function kindOf(path: string): 'PDF' | 'CBZ' | null {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'PDF'
  if (ext === 'cbz' || ext === 'zip') return 'CBZ'
  return null
}

/** Chapters of a manga: sorted by number, click to read; what is read is greyed with « Lu », a chapter
 *  started shows its page. Several versions (VF / VOSTFR, colour / black & white): one at a time.
 *  « Sélectionner » (or a long press / right click on a chapter) marks chapters read or unread at once. */
export default function ChaptersSection({ media, chapters, reading, onRead, onMark, onScan, scanning }: Props) {
  const [desc, setDesc] = useState(false)
  const phone = useShell().device === 'phone'
  const versions = useMemo(() => chapterVersions(chapters), [chapters])
  const [picked, setPicked] = useState<string | null>(null)
  // The version being read first (where « Continuer » goes), else the default one
  const readingVersion = reading.next?.chapter.language ?? null
  const version = picked && versions.includes(picked) ? picked
    : readingVersion && versions.includes(readingVersion) ? readingVersion : versions[0] ?? null
  const shown = useMemo(() => (version ? chapters.filter((c) => c.language === version) : chapters), [chapters, version])
  const sorted = useMemo(
    () => [...shown].sort((a, b) => (desc ? -1 : 1) * (a.chapterNumber - b.chapterNumber || a.folderPath.localeCompare(b.folderPath, undefined, { numeric: true }))),
    [shown, desc],
  )
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const anchor = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const menu = useContextMenu()

  const offline = useOfflineOf(media, chapters)
  const isRead = (c: Chapter) => reading.readNumbers.has(c.chapterNumber)
  const readHere = shown.filter(isRead).length

  /** From the last chapter tapped to this one (both included), in the order shown */
  function rangeTo(id: string): string[] {
    const from = sorted.findIndex((c) => c.id === (anchor.current ?? id))
    const to = sorted.findIndex((c) => c.id === id)
    const [a, b] = from < to ? [from, to] : [to, from]
    return sorted.slice(a, b + 1).map((c) => c.id)
  }
  function toggle(id: string, range = false) {
    setSelected((s) => {
      const next = new Set(s)
      if (range && anchor.current) rangeTo(id).forEach((x) => next.add(x))
      else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    anchor.current = id
  }
  function stopSelecting() { setSelecting(false); setSelected(new Set()); anchor.current = null }

  async function mark(ids: string[], read: boolean) {
    if (!ids.length) return
    setBusy(true)
    try {
      await onMark(ids, read)
      toast.success(read ? `${chaptersWord(ids.length)} marqué${ids.length > 1 ? 's' : ''} comme lu${ids.length > 1 ? 's' : ''}` : `${chaptersWord(ids.length)} marqué${ids.length > 1 ? 's' : ''} comme non lu${ids.length > 1 ? 's' : ''}`)
      stopSelecting()
    } catch { toast.error('Impossible d’enregistrer : réessaie') }
    finally { setBusy(false) }
  }
  /** Every chapter up to this one (by number, in this version) */
  const upTo = (c: Chapter) => shown.filter((x) => x.chapterNumber <= c.chapterNumber).map((x) => x.id)

  function itemsFor(c: Chapter, name: string): MenuItem[] {
    if (selecting) {
      return [{ label: 'Sélectionner jusqu’ici', icon: <ListChecks />, onSelect: () => toggle(c.id, true) }]
    }
    const read = isRead(c)
    const page = reading.pageOf.get(c.id)
    return [
      { label: page ? `Reprendre à la page ${page + 1}` : 'Lire', icon: <BookOpen />, onSelect: () => onRead(c.id, version ?? undefined, page) },
      read
        ? { label: 'Marquer comme non lu', icon: <Circle />, onSelect: () => void mark([c.id], false) }
        : { label: 'Marquer comme lu', icon: <Check />, onSelect: () => void mark([c.id], true) },
      { label: `Marquer comme lus jusqu’au ${name.toLowerCase()}`, icon: <CheckCheck />, onSelect: () => void mark(upTo(c), true) },
      { separator: true },
      { label: 'Sélectionner', icon: <ListChecks />, onSelect: () => { setSelecting(true); toggle(c.id) } },
    ]
  }

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

  const allSelected = selected.size === sorted.length
  const selectAll = () => { setSelected(allSelected ? new Set() : new Set(sorted.map((c) => c.id))); anchor.current = null }
  const selection = [...selected]
  const selectionRead = selection.length > 0 && selection.every((id) => { const c = shown.find((x) => x.id === id); return !!c && isRead(c) })

  return (
    <div className={cn('mb-10', phone && selecting && 'pb-16')}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-title text-label">Chapitres</h2>
          <p className="text-subhead text-label2 mt-0.5 tabular">
            {selecting ? (selected.size ? `${chaptersWord(selected.size)} sélectionné${selected.size > 1 ? 's' : ''}` : 'Touche les chapitres à marquer')
              : `${chaptersWord(shown.length)}${readHere ? ` · ${readHere === shown.length ? 'tous lus' : `${readHere} lu${readHere > 1 ? 's' : ''}`}` : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selecting ? (
            <>
              {!phone && (
                <>
                  <Button variant="plain" onClick={selectAll}>{allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}</Button>
                  <Button disabled={!selected.size || busy} onClick={() => void mark(selection, !selectionRead)}>
                    {selectionRead ? 'Marquer comme non lu' : 'Marquer comme lu'}
                  </Button>
                </>
              )}
              <Button variant={phone ? 'plain' : 'primary'} className={phone ? 'font-semibold' : undefined} onClick={stopSelecting}>OK</Button>
            </>
          ) : (
            <>
              <Button variant="plain" onClick={() => setDesc((d) => !d)} aria-label={desc ? 'Trier du premier au dernier' : 'Trier du dernier au premier'}>
                {desc ? 'Du plus récent' : 'Dans l’ordre'}
              </Button>
              <Button variant="plain" onClick={() => setSelecting(true)}>Sélectionner</Button>
            </>
          )}
        </div>
      </div>
      {versions.length > 1 && (
        <SegmentedControl label="Version" value={version ?? ''} onChange={(v) => { setPicked(v); stopSelecting() }} full={phone} className="mb-3"
          options={versions.map((v) => ({ value: v, label: versionName(v, versions) }))} />
      )}
      {offline.supported && !selecting && <OfflineGroup offline={offline} onSwitch={(on) => offline.toggle(on, version)} phone={phone} />}
      <Group>
        {sorted.map((c) => {
          const name = c.title || `Chapitre ${formatNumber(c.chapterNumber)}`
          const read = isRead(c)
          const page = reading.pageOf.get(c.id)
          const on = selected.has(c.id)
          const detail = page != null && !read
            ? `Page ${page + 1}${c.pageCount ? ` sur ${c.pageCount}` : ''}`
            : [kindOf(c.folderPath), c.pageCount ? `${c.pageCount} p.` : null].filter(Boolean).join(' · ')
          return (
            // The row reads the chapter (or selects it); the button on its right keeps it on the device (or not)
            <div key={c.id} role="listitem" className="nx-row relative flex items-center min-h-row">
              <button type="button"
                className={cn('flex-1 min-w-0 flex items-center gap-3 pl-4 min-h-row text-left pressable hoverable', offline.supported && !selecting ? 'pr-1' : 'pr-4')}
                onClick={(e) => (selecting ? toggle(c.id, e.shiftKey) : onRead(c.id, version ?? undefined, page))}
                aria-pressed={selecting ? on : undefined}
                {...menu.bind(itemsFor(c, name), name)}>
                {selecting && (
                  <span className={cn('w-[22px] h-[22px] rounded-full grid place-items-center flex-shrink-0', on ? 'bg-accent text-white' : 'border-[1.5px] border-label3')} aria-hidden="true">
                    {on && <Check size={14} strokeWidth={3} />}
                  </span>
                )}
                <span className={cn('flex-1 min-w-0 truncate py-[7px] max-md:py-[11px]', read ? 'text-label2' : 'text-label')}>{name}</span>
                {read ? (
                  <span className="flex items-center gap-1 text-label2 flex-shrink-0" aria-label="Lu">
                    <Check size={phone ? 16 : 14} strokeWidth={2.25} aria-hidden="true" />Lu
                  </span>
                ) : detail ? (
                  <span className={cn('tabular truncate max-w-[45%] text-right', page != null ? 'text-accent-text' : 'text-label2')}>{detail}</span>
                ) : null}
              </button>
              {offline.supported && !selecting && (
                <OfflineButton name={name} state={offline.stateOf(c.id)} onKeep={() => offline.keep(c.id)} onRelease={() => offline.release(c.id)} />
              )}
            </div>
          )
        })}
      </Group>

      {/* Phone: the selection's toolbar, above the tab bar */}
      {phone && selecting && (
        <SelectionBar>
          <Button variant="plain" className="text-[17px]" onClick={selectAll}>{allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}</Button>
          <Button variant="plain" className="text-[17px] font-semibold" disabled={!selected.size || busy} onClick={() => void mark(selection, !selectionRead)}>
            {selectionRead ? 'Non lu' : 'Marquer comme lu'}{selected.size ? ` (${selected.size})` : ''}
          </Button>
        </SelectionBar>
      )}
      {menu.element}
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
