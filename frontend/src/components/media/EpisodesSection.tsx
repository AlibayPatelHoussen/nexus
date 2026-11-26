import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Check, CheckCheck, ChevronsUpDown, Circle, ListChecks, Play, Tv } from 'lucide-react'
import type { Episode } from '@/types'
import type { EpisodeProgress } from '@/services/mediaService'
import Button from '@/components/ui/Button'
import PullDownMenu from '@/components/ui/PullDownMenu'
import SelectionBar from '@/components/ui/SelectionBar'
import { useContextMenu } from '@/components/ui/useContextMenu'
import type { MenuItem } from '@/components/ui/ContextMenu'
import { useShell } from '@/components/shell/shellContext'
import { cn, formatDuration } from '@/utils'
import { episodesUpTo } from './watchState'

interface Props {
  episodes:        Episode[]
  seasons:         number[]
  activeSeason:    number
  onSeasonChange:  (season: number) => void
  progress:        Map<string, EpisodeProgress>
  nextEpisodeId?:  string
  onPlay:          (episodeId: string) => void
  /** « Marquer comme vu / non vu » */
  onMark:          (episodeIds: string[], watched: boolean) => Promise<void>
}

const seasonLabel = (s: number) => (s === 0 ? 'Spéciaux' : `Saison ${s}`)
const episodesWord = (n: number) => `${n} épisode${n > 1 ? 's' : ''}`

/** Season picker + episodes (whole still, number and title, synopsis, progress). What is watched shows « Vu »;
 *  « Sélectionner » (or a long press / right click on an episode) marks episodes watched or not at once. */
export default function EpisodesSection({ episodes, seasons, activeSeason, onSeasonChange, progress, nextEpisodeId, onPlay, onMark }: Props) {
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const { device } = useShell()
  const phone = device === 'phone'
  const list = episodes.filter((e) => (e.season ?? 1) === activeSeason)
  const isWatched = (id: string) => !!progress.get(id)?.completed
  const watched = list.filter((e) => isWatched(e.id)).length
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const anchor = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const menu = useContextMenu()

  /** From the last episode tapped to this one (both included), in this season */
  function rangeTo(id: string): string[] {
    const from = list.findIndex((e) => e.id === (anchor.current ?? id))
    const to = list.findIndex((e) => e.id === id)
    if (from === -1) return [id]
    const [a, b] = from < to ? [from, to] : [to, from]
    return list.slice(a, b + 1).map((e) => e.id)
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

  async function mark(ids: string[], on: boolean) {
    if (!ids.length) return
    // The season shown stays (the next episode can be in another one now)
    onSeasonChange(activeSeason)
    setBusy(true)
    try {
      await onMark(ids, on)
      const many = ids.length > 1
      toast.success(`${episodesWord(ids.length)} marqué${many ? 's' : ''} comme ${on ? 'vu' : 'non vu'}${many ? 's' : ''}`)
      stopSelecting()
    } catch { toast.error('Impossible d’enregistrer : réessaie') }
    finally { setBusy(false) }
  }

  function itemsFor(ep: Episode): MenuItem[] {
    if (selecting) return [{ label: 'Sélectionner jusqu’ici', icon: <ListChecks />, onSelect: () => toggle(ep.id, true) }]
    const p = progress.get(ep.id)
    const done = isWatched(ep.id)
    const resume = !!p && !p.completed && p.progress > 30
    const seasonDone = list.every((e) => isWatched(e.id))
    const where = seasons.length > 1 ? `S${ep.season ?? 1}, É${ep.episodeNumber}` : `l’épisode ${ep.episodeNumber}`
    return [
      { label: resume ? 'Reprendre' : 'Lire', icon: <Play />, onSelect: () => onPlay(ep.id) },
      done
        ? { label: 'Marquer comme non vu', icon: <Circle />, onSelect: () => void mark([ep.id], false) }
        : { label: 'Marquer comme vu', icon: <Check />, onSelect: () => void mark([ep.id], true) },
      { label: `Marquer comme vus jusqu’à ${where}`, icon: <CheckCheck />, onSelect: () => void mark(episodesUpTo(episodes, ep).map((e) => e.id), true) },
      seasonDone
        ? { label: `Marquer la ${seasonLabel(activeSeason).toLowerCase()} comme non vue`, icon: <Circle />, onSelect: () => void mark(list.map((e) => e.id), false) }
        : { label: `Marquer la ${seasonLabel(activeSeason).toLowerCase()} comme vue`, icon: <CheckCheck />, onSelect: () => void mark(list.map((e) => e.id), true) },
      { separator: true },
      { label: 'Sélectionner', icon: <ListChecks />, onSelect: () => { setSelecting(true); toggle(ep.id) } },
    ]
  }

  const allSelected = list.length > 0 && list.every((e) => selected.has(e.id))
  const selectAll = () => {
    setSelected((s) => {
      const next = new Set(s)
      list.forEach((e) => (allSelected ? next.delete(e.id) : next.add(e.id)))
      return next
    })
    anchor.current = null
  }
  const selection = [...selected]
  const selectionWatched = selection.length > 0 && selection.every(isWatched)

  return (
    <section className={cn('mb-4', phone && selecting && 'pb-16')} aria-labelledby="episodes-title">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 mb-3.5">
      <div className="min-w-0">
      {/* Apple TV: « Saison 1 ⇅ » is the section title and a pull-down menu */}
      <h2 id="episodes-title" className={cn('flex items-center font-bold text-label', phone ? 'text-[22px]' : 'text-[19px]')}>
        {seasons.length > 1 ? (
          <PullDownMenu
            label="Saison"
            value={activeSeason}
            onChange={onSeasonChange}
            options={seasons.map((s) => ({ value: s, label: seasonLabel(s) }))}
            className="-mx-1 px-1 hoverable"
          >
            {seasonLabel(activeSeason)}
            <ChevronsUpDown size={phone ? 20 : 16} strokeWidth={2.25} className="text-label2" aria-hidden="true" />
          </PullDownMenu>
        ) : seasonLabel(seasons[0] ?? 1)}
      </h2>
      <p className="text-subhead text-label2 mt-0.5 tabular">
        {selecting ? (selected.size ? `${episodesWord(selected.size)} sélectionné${selected.size > 1 ? 's' : ''}` : 'Touche les épisodes à marquer')
          : `${episodesWord(list.length)}${watched ? ` · ${watched === list.length ? 'tous vus' : `${watched} vu${watched > 1 ? 's' : ''}`}` : ''}`}
      </p>
      </div>
      <div className="flex items-center gap-2">
        {selecting ? (
          <>
            {!phone && (
              <>
                <Button variant="plain" onClick={selectAll}>{allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}</Button>
                <Button disabled={!selected.size || busy} onClick={() => void mark(selection, !selectionWatched)}>
                  {selectionWatched ? 'Marquer comme non vu' : 'Marquer comme vu'}
                </Button>
              </>
            )}
            <Button variant={phone ? 'plain' : 'primary'} className={phone ? 'font-semibold' : undefined} onClick={stopSelecting}>OK</Button>
          </>
        ) : (
          <Button variant="plain" onClick={() => setSelecting(true)}>Sélectionner</Button>
        )}
      </div>
      </div>

      {/* Apple TV: episodes side by side, 16:9 still with its progress, text underneath */}
      <ol className="shelf shelf--wide !mb-0 list-none">
        <li className="contents">
          <div className="shelf__scroller scrollbar-none">
            {list.map((ep) => {
              const p      = progress.get(ep.id)
              const total  = p?.duration || ep.duration || 0
              const pct    = p && total ? Math.min(100, Math.round((p.progress / total) * 100)) : 0
              const done   = !!p?.completed
              const isNext = ep.id === nextEpisodeId
              const title  = ep.title || `Épisode ${ep.episodeNumber}`
              const still  = ep.thumbnailPath && !broken.has(ep.id) ? ep.thumbnailPath : null
              const on     = selected.has(ep.id)
              return (
                <button
                  key={ep.id}
                  type="button"
                  className={cn('group snap-start min-w-0 text-left rounded-card press-soft', phone && 'relative flex flex-col overflow-hidden bg-fill shadow-[inset_0_0_0_1px_var(--poster-rim)]', phone && still && 'scheme-dark')}
                  onClick={(e) => (selecting ? toggle(ep.id, e.shiftKey) : onPlay(ep.id))}
                  aria-pressed={selecting ? on : undefined}
                  aria-label={`${selecting ? '' : 'Lire '}${seasonLabel(ep.season ?? 1)} épisode ${ep.episodeNumber} : ${title}${done ? ', vu' : ''}`}
                  {...menu.bind(itemsFor(ep), title)}
                >
                  <span className={cn('relative block aspect-video overflow-hidden bg-fill', !phone && 'rounded-card shadow-[inset_0_0_0_1px_var(--poster-rim)] transition-shadow duration-300 group-hover:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.5)]')}>
                    {still ? (
                      <img src={still} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                        onError={() => setBroken((b) => new Set(b).add(ep.id))} />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center gap-1.5 text-label3">
                        <Tv size={18} strokeWidth={1.5} aria-hidden="true" />
                        <span className="text-headline tabular">{ep.episodeNumber}</span>
                      </span>
                    )}
                    {!selecting && (
                      <span className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity duration-200" aria-hidden="true">
                        <span className="w-11 h-11 rounded-full grid place-items-center glass-clear"><Play size={16} fill="currentColor" strokeWidth={0} className="ml-0.5" /></span>
                      </span>
                    )}
                    {selecting && (
                      // Like Photos: a white ring, filled with the tint once chosen
                      <span className={cn('absolute top-2 left-2 w-6 h-6 rounded-full grid place-items-center border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,0.35)]', on ? 'bg-accent text-white' : 'bg-black/25')} aria-hidden="true">
                        {on && <Check size={14} strokeWidth={3} />}
                      </span>
                    )}
                    {pct > 0 && !done && (
                      <span className="absolute inset-x-2.5 bottom-2.5 h-[3px] rounded-full overflow-hidden bg-white/35">
                        <span className="block h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
                      </span>
                    )}
                    {done && (
                      <span className="absolute top-2 right-2 w-6 h-6 rounded-full grid place-items-center glass-clear" aria-label="Vu">
                        <Check size={13} strokeWidth={2.75} />
                      </span>
                    )}
                  </span>
                  <span className={cn('relative block', phone ? 'flex-1 px-3.5 pt-2.5 pb-3.5 overflow-hidden' : 'mt-2.5 px-0.5')}>
                    {/* iPhone: the text sits on the still, blurred and darkened (Apple TV card) */}
                    {phone && still && (
                      <span className="absolute inset-0 pointer-events-none" aria-hidden="true">
                        <img src={still} alt="" className="absolute inset-x-0 bottom-0 w-full h-[200%] object-cover object-bottom scale-110 blur-2xl" />
                        <span className="absolute inset-0 bg-black/50" />
                      </span>
                    )}
                    <span className={cn('relative block text-caption font-semibold uppercase tracking-[0.04em] tabular', isNext ? 'text-accent-text' : 'text-label2')}>
                      {isNext ? (pct > 0 && !done ? 'En cours' : 'À suivre') + ' · ' : ''}Épisode {ep.episodeNumber}{done ? ' · Vu' : ''}
                    </span>
                    <span className="relative block text-body font-semibold text-label leading-snug line-clamp-1 mt-0.5">{title}</span>
                    {ep.overview && <span className="relative block text-subhead text-label2 mt-1 line-clamp-3">{ep.overview}</span>}
                    <span className="relative block text-caption text-label2 mt-1 tabular">
                      {[ep.duration ? formatDuration(ep.duration) : null,
                        ep.airDate ? new Date(ep.airDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </li>
      </ol>

      {/* Phone: the selection's toolbar, above the tab bar */}
      {phone && selecting && (
        <SelectionBar>
          <Button variant="plain" className="text-[17px]" onClick={selectAll}>{allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}</Button>
          <Button variant="plain" className="text-[17px] font-semibold" disabled={!selected.size || busy} onClick={() => void mark(selection, !selectionWatched)}>
            {selectionWatched ? 'Non vu' : 'Marquer comme vu'}{selected.size ? ` (${selected.size})` : ''}
          </Button>
        </SelectionBar>
      )}
      {menu.element}
    </section>
  )
}
