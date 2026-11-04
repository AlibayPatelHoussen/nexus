import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { isAxiosError } from 'axios'
import {
  SOURCE_INFO, downloadsService, originalImage, type DetailChapter, type DetailEpisode, type SearchResult, type TorrentGroup,
} from '@/services/downloadsService'
import { useShell } from '@/components/shell/shellContext'
import Sheet from '@/components/ui/Sheet'
import Button from '@/components/ui/Button'
import Toggle from '@/components/ui/Toggle'
import SegmentedControl from '@/components/ui/SegmentedControl'
import EmptyState from '@/components/ui/EmptyState'
import Skeleton from '@/components/ui/Skeleton'
import { useConfirm } from '@/components/ui/useConfirm'
import Artwork from '@/components/media/Artwork'
import KindBadge from '@/components/downloads/KindBadge'
import { cn } from '@/utils'
import { formatDuration } from './SearchView'
import TorrentSheet from './TorrentSheet'

/** off = shown but cannot be chosen (movix: not out yet, or not in this language); date = TMDB air date */
interface Item { n: number; label?: string; done: boolean; off?: string; date?: string | null }

/** Episodes / chapters as number chips (One Piece has 1100+ chapters), with a range and select all. */
function ItemPicker({ items, selected, onChange, noun }: { items: Item[]; selected: Set<number>; onChange: (s: Set<number>) => void; noun: string }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const all = items.map((i) => i.n)
  const out = items.filter((i) => !i.off).map((i) => i.n)
  const missing = items.filter((i) => !i.done && !i.off).map((i) => i.n)
  const toggle = (n: number) => { const s = new Set(selected); if (s.has(n)) s.delete(n); else s.add(n); onChange(s) }
  const applyRange = () => {
    const a = Number(from || all[0]), b = Number(to || all[all.length - 1])
    if (!Number.isFinite(a) || !Number.isFinite(b)) return
    onChange(new Set(out.filter((n) => n >= Math.min(a, b) && n <= Math.max(a, b))))
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="small" onClick={() => onChange(new Set(missing))}>Tout sélectionner</Button>
        <Button size="small" variant="plain" onClick={() => onChange(new Set())} disabled={!selected.size}>Aucun</Button>
        <span className="flex items-center gap-1.5 text-subhead text-label2 ml-auto">
          De
          <input inputMode="decimal" value={from} onChange={(e) => setFrom(e.target.value.replace(/[^\d.]/g, ''))} placeholder={String(all[0] ?? '')}
            aria-label={`Premier ${noun}`} className="w-16 h-7 px-2 rounded-[6px] bg-fill text-label text-center tabular outline-none" />
          à
          <input inputMode="decimal" value={to} onChange={(e) => setTo(e.target.value.replace(/[^\d.]/g, ''))} placeholder={String(all[all.length - 1] ?? '')}
            aria-label={`Dernier ${noun}`} className="w-16 h-7 px-2 rounded-[6px] bg-fill text-label text-center tabular outline-none" />
          <Button size="small" onClick={applyRange}>Choisir</Button>
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5 max-h-[42vh] overflow-y-auto p-0.5" role="group" aria-label={`${noun}s`}>
        {items.map((it) => {
          const on = selected.has(it.n)
          const soon = !!it.off
          return (
            <button key={it.n} type="button" onClick={() => toggle(it.n)} aria-pressed={on} disabled={soon}
              title={`${it.label ?? `${noun} ${it.n}`}${it.done ? ' — déjà téléchargé' : ''}${it.off ? ` — ${it.off}` : ''}`}
              className={cn('relative h-9 rounded-[8px] text-subhead tabular font-medium',
                on ? 'bg-accent-fill text-white' : soon ? 'bg-fill text-label3 opacity-50 border border-dashed border-separator cursor-not-allowed' : it.done ? 'bg-fill text-label3' : 'bg-fill text-label')}>
              {it.n}
              {it.done && <Check size={10} strokeWidth={3} className={cn('absolute top-1 right-1', on ? 'text-white' : 'text-ok-text')} aria-hidden="true" />}
            </button>
          )
        })}
      </div>
      <p className="text-caption text-label2">
        {selected.size} {noun}{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
        {items.some((i) => i.done) && <> · <Check size={10} strokeWidth={3} className="inline text-ok-text" aria-hidden="true" /> déjà téléchargé</>}
        {items.some((i) => i.off) && <> · en pointillés : pas disponible{nextOut(items)}</>}
      </p>
    </div>
  )
}

const today = () => new Date().toISOString().slice(0, 10)
const formatDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

/** « (prochain le 12 janvier 2027) » when the next episode has a date. */
function nextOut(items: Item[]) {
  const next = items.filter((i) => i.off && i.date && i.date > today()).map((i) => i.date!).sort()[0]
  return next ? ` (prochain le ${formatDay(next)})` : ''
}

/** OxTorrent cards (versions inside) have their own sheet; every other site keeps this one, unchanged. */
export default function DetailSheet({ result, onClose }: { result: SearchResult | null; onClose: () => void }) {
  if (result?.source === 'oxtorrent') return <TorrentSheet result={result as TorrentGroup} onClose={onClose} />
  return <StandardSheet result={result} onClose={onClose} />
}

function StandardSheet({ result, onClose }: { result: SearchResult | null; onClose: () => void }) {
  const { device } = useShell()
  const phone = device === 'phone'
  const qc = useQueryClient()
  const confirm = useConfirm()
  const r = result
  const needsDetails = !!r && r.kind !== 'youtube' && r.source !== 'films'
  const { data: details, isLoading, isError, refetch } = useQuery({
    queryKey: ['dl-details', r?.id],
    queryFn: () => downloadsService.details(r!.id),
    enabled: needsDetails,
    staleTime: 60_000,
    retry: false,
  })

  const [season, setSeason] = useState<string>('')
  const [lang, setLang] = useState<string>('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const followable = !!r && (r.kind === 'anime' || r.kind === 'serie' || r.kind === 'manga')
  const { data: follow, refetch: refetchFollow } = useQuery({
    queryKey: ['dl-follow', r?.id], queryFn: () => downloadsService.follow(r!.id), enabled: followable, retry: false,
  })
  const [following, setFollowing] = useState(false)

  async function toggleFollow(on: boolean) {
    if (!r) return
    setFollowing(true)
    try {
      await downloadsService.setFollow({
        id: r.id, enabled: on, title: details?.title || r.title, poster_url: originalImage(r.poster_url), lang,
        ...(r.kind !== 'manga' ? { season } : {}),
      })
      await refetchFollow()
      toast.success(on ? 'Les nouveautés seront téléchargées automatiquement' : 'Téléchargement automatique désactivé')
    } catch (err) {
      toast.error(isAxiosError(err) ? err.response?.data?.error ?? 'Impossible de changer ce réglage.' : 'Impossible de changer ce réglage.')
    } finally {
      setFollowing(false)
    }
  }

  // Seasons (anime: one entry per season + language) / languages
  const seasonIds = useMemo(() => [...new Map((details?.seasons ?? []).map((s) => [String(s.id), s.label.split(' — ')[0]])).entries()], [details])
  const langsForSeason = useMemo(() => {
    if (r?.kind === 'anime') return (details?.seasons ?? []).filter((s) => String(s.id) === season).map((s) => s.lang!).filter(Boolean)
    if (r?.kind === 'manga') return (details?.langs ?? []).map((l) => (typeof l === 'string' ? l : l.lang))
    // movix: the languages the sources really have (season, film), else both
    if (r?.kind === 'serie') return (details?.seasons ?? []).find((s) => String(s.id) === season)?.langs ?? ['VF', 'VOSTFR']
    const film = (details?.langs ?? []).filter((l): l is { lang: string; available?: boolean } => typeof l !== 'string' && l.available !== false).map((l) => l.lang)
    return film.length ? film : ['VF', 'VOSTFR']
  }, [details, season, r?.kind])

  useEffect(() => { setSeason(''); setLang(''); setSelected(new Set()) }, [r?.id])
  useEffect(() => { if (!season && seasonIds.length) setSeason(seasonIds[0][0]) }, [seasonIds, season])
  useEffect(() => {
    if (!langsForSeason.includes(lang)) setLang(langsForSeason.includes('VOSTFR') && r?.kind === 'anime' ? 'VOSTFR' : langsForSeason[0] ?? '')
  }, [langsForSeason, lang, r?.kind])

  const items: Item[] = useMemo(() => {
    if (!details) return []
    if (r?.kind === 'manga') {
      const l = (details.langs ?? []).find((x) => typeof x !== 'string' && x.lang === lang) as { chapters?: DetailChapter[] } | undefined
      return (l?.chapters ?? []).map((c) => ({ n: c.n, label: `Chapitre ${c.n} · ${c.pages} pages`, done: c.downloaded }))
    }
    const s = (details.seasons ?? []).find((x) => String(x.id) === season && (r?.kind !== 'anime' || x.lang === lang))
    return (s?.episodes ?? []).map((e: DetailEpisode) => ({
      n: e.n, label: e.label, done: Array.isArray(e.downloaded) ? e.downloaded.includes(lang) : !!e.downloaded,
      ...(e.available === false
        ? { off: `pas encore disponible${e.air_date && e.air_date > today() ? ` (sortie le ${formatDay(e.air_date)})` : ''}`, date: e.air_date }
        : e.langs && !e.langs.includes(lang) ? { off: `pas disponible en ${lang} (seulement ${e.langs.join(', ')})` } : {}),
    }))
  }, [details, season, lang, r?.kind])
  useEffect(() => { setSelected(new Set()) }, [season, lang])

  const filmDone = r?.kind === 'film' && (details?.langs ?? []).some((l) => typeof l !== 'string' && l.lang === lang && l.downloaded)

  async function queue(force = false) {
    if (!r) return
    const multi = r.kind === 'anime' || r.kind === 'serie' || r.kind === 'manga'
    if (multi && !selected.size) { toast('Choisis au moins un élément.'); return }
    setBusy(true)
    try {
      await downloadsService.create({
        id: r.id, title: details?.title || r.title, poster_url: originalImage(r.poster_url ?? r.thumbnail_url),
        ...(r.kind !== 'youtube' && r.source !== 'films' && lang ? { lang } : {}),
        ...(r.kind === 'anime' || r.kind === 'serie' ? { season, episodes: [...selected] } : {}),
        ...(r.kind === 'manga' ? { chapters: [...selected] } : {}),
        force,
      })
      void qc.invalidateQueries({ queryKey: ['downloads'] })
      toast.success(`${r.title} ajouté à la file`)
      onClose()
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 409 && err.response.data?.details?.duplicate) {
        setBusy(false)
        const ok = await confirm({
          title: 'Déjà téléchargé',
          message: `${err.response.data.error}. Télécharger quand même ? Les fichiers déjà présents seront gardés.`,
          confirmLabel: 'Télécharger',
        })
        if (ok) await queue(true)
        return
      }
      toast.error(isAxiosError(err) ? err.response?.data?.error ?? 'Impossible d’ajouter ce téléchargement.' : 'Impossible d’ajouter ce téléchargement.')
    } finally {
      setBusy(false)
    }
  }

  if (!r) return <Sheet open={false} onClose={onClose} />

  const multi = r.kind === 'anime' || r.kind === 'serie' || r.kind === 'manga'
  const count = selected.size
  const action = multi
    ? `Télécharger${count ? ` ${count} ${r.kind === 'manga' ? `chapitre${count > 1 ? 's' : ''}` : `épisode${count > 1 ? 's' : ''}`}` : ''}`
    : 'Télécharger'
  const canQueue = !busy && (!needsDetails || !!details) && (!multi || count > 0)
  const video = r.kind === 'youtube'

  const footer = (
    <>
      {!phone && <Button onClick={onClose}>Annuler</Button>}
      <Button variant="primary" size={phone ? 'large' : 'regular'} loading={busy} disabled={!canQueue} onClick={() => queue()}>{action}</Button>
    </>
  )

  return (
    <Sheet open={!!r} onClose={onClose} size="lg" title={phone ? undefined : r.title} footer={footer}
      phoneHeader={{ left: <Button variant="plain" onClick={onClose}>Annuler</Button> }}>
      <div className="flex flex-col gap-5">
        <div className="flex gap-4">
          <Artwork src={video ? r.thumbnail_url ?? r.poster_url : details?.poster_url ?? r.poster_url} alt="" ratio={video ? '16 / 9' : '2 / 3'}
            type={r.kind} title={r.title} cover={video} loading="eager"
            className={cn('flex-shrink-0 rounded-[8px]', video ? 'w-[200px] max-sm:w-[140px]' : 'w-[96px] max-sm:w-[76px]')} />
          <div className="min-w-0 flex flex-col gap-1.5">
            {phone && <h2 className="text-headline text-label">{r.title}</h2>}
            <div className="flex flex-wrap items-center gap-2 text-subhead text-label2">
              <KindBadge kind={r.kind} />
              {r.year && <span className="tabular">{r.year}</span>}
              {video && r.channel && <span>{r.channel}</span>}
              {video && r.duration ? <span className="tabular">{formatDuration(r.duration)}</span> : null}
            </div>
            <p className="text-caption text-label2">
              Source : <span className="text-label">{SOURCE_INFO[r.source]?.site}</span> · script <span className="font-mono">{SOURCE_INFO[r.source]?.script}</span>
            </p>
            {(details?.description || r.description) && (
              <p className="text-subhead text-label2 line-clamp-4">{details?.description || r.description}</p>
            )}
          </div>
        </div>

        {needsDetails && isLoading && (
          <div className="flex flex-col gap-3" aria-label="Chargement de la liste">
            <Skeleton className="h-7 w-64" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5">{Array.from({ length: 24 }).map((_, i) => <Skeleton key={i} className="h-9 rounded-[8px]" />)}</div>
          </div>
        )}
        {needsDetails && isError && (
          <EmptyState className="py-6" tone="error" icon={<AlertTriangle strokeWidth={1.25} />} title="Liste indisponible"
            message="Le site n’a pas répondu." action={<Button size="small" onClick={() => refetch()}>Réessayer</Button>} />
        )}

        {details && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              {(r.kind === 'anime' || r.kind === 'serie') && seasonIds.length > 0 && (
                <label className="relative inline-flex items-center">
                  <span className="sr-only">Saison</span>
                  <select value={season} onChange={(e) => setSeason(e.target.value)}
                    className="h-8 pl-3 pr-8 rounded-[8px] bg-fill text-label text-body appearance-none outline-none">
                    {seasonIds.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                  <span className="pointer-events-none absolute right-2.5 text-label2 text-caption" aria-hidden="true">▾</span>
                </label>
              )}
              {langsForSeason.length > 1 && (
                <SegmentedControl label="Langue" value={lang} onChange={setLang} options={langsForSeason.map((l) => ({ value: l, label: l }))} />
              )}
              {langsForSeason.length === 1 && <span className="text-subhead text-label2">{langsForSeason[0]}</span>}
            </div>
            {multi && (items.length
              ? <ItemPicker items={items} selected={selected} onChange={setSelected} noun={r.kind === 'manga' ? 'chapitre' : 'épisode'} />
              : <p className="text-subhead text-label2">Rien de disponible pour ce choix.</p>)}
            {filmDone && <p className="flex items-center gap-1.5 text-subhead text-ok-text"><Check size={14} strokeWidth={2.5} />Déjà téléchargé en {lang}</p>}
            {followable && (
              <div className="flex items-start justify-between gap-4 rounded-[10px] bg-fill2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-body text-label">Télécharger automatiquement les {r.kind === 'manga' ? 'nouveaux chapitres' : 'nouveaux épisodes'}</p>
                  <p className="text-caption text-label2 mt-0.5">
                    {follow?.enabled
                      ? `${[follow.options.season ? seasonIds.find(([id]) => id === String(follow.options.season))?.[1] ?? follow.options.season : null, follow.options.lang].filter(Boolean).join(' · ')} · vérifié chaque jour${follow.last_error ? ` · dernier essai : ${follow.last_error}` : ''}`
                      : 'Désactivé : rien ne se télécharge sans toi.'}
                  </p>
                </div>
                <Toggle checked={!!follow?.enabled} disabled={following || !lang || (r.kind !== 'manga' && !season)}
                  onChange={(v) => { void toggleFollow(v) }} label="Télécharger automatiquement les nouveautés" />
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}
