import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download as DownloadIcon, Search, X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Socket } from 'socket.io-client'
import { SOURCE_INFO, downloadsService, type DownloadKind, type DownloadSource, type SearchResult } from '@/services/downloadsService'
import { useShell } from '@/components/shell/shellContext'
import SegmentedControl from '@/components/ui/SegmentedControl'
import EmptyState from '@/components/ui/EmptyState'
import Skeleton from '@/components/ui/Skeleton'
import Spinner from '@/components/ui/Spinner'
import Artwork from '@/components/media/Artwork'
import KindBadge from '@/components/downloads/KindBadge'
import { cn } from '@/utils'
import DetailSheet from './DetailSheet'

type Filter = 'all' | DownloadKind
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Tout' }, { value: 'anime', label: 'Animés' }, { value: 'manga', label: 'Mangas' },
  { value: 'film', label: 'Films' }, { value: 'serie', label: 'Séries' }, { value: 'youtube', label: 'YouTube' },
]
const SOURCE_LABEL = Object.fromEntries(Object.entries(SOURCE_INFO).map(([k, v]) => [k, v.site])) as Record<DownloadSource, string>

interface SourceState { done: boolean; count: number; error: string | null }
interface SearchState { query: string; searchId: string | null; results: SearchResult[]; sources: Partial<Record<DownloadSource, SourceState>> }

// Kept while the app is open: coming back to the page shows the last search
let lastSearch: SearchState = { query: '', searchId: null, results: [], sources: {} }

/**
 * Order of the results: anime (anime-sama), manga (anime-sama), films (films.py),
 * films (movix), series (movix), YouTube videos.
 */
const ORDER: string[] = ['anisama:anime', 'anisama:manga', 'films:film', 'movix:film', 'movix:serie', 'youtube:youtube']
export function rank(r: Pick<SearchResult, 'source' | 'kind'>): number {
  const i = ORDER.indexOf(`${r.source}:${r.kind}`)
  return i < 0 ? ORDER.length : i
}

export function formatDuration(s?: number | null) {
  if (!s) return ''
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

function subtitleOf(r: SearchResult) {
  // Always say where it comes from: "2 saisons · anime-sama"
  const site = SOURCE_INFO[r.source]?.site
  let detail = ''
  if (r.kind === 'youtube') detail = [r.channel, formatDuration(r.duration)].filter(Boolean).join(' · ')
  else if ((r.kind === 'anime' || r.kind === 'serie') && r.seasons?.length) detail = `${r.seasons.length} saison${r.seasons.length > 1 ? 's' : ''}`
  else if (r.kind === 'manga' && r.langs?.length) detail = r.langs.join(', ')
  return [detail, r.kind === 'youtube' ? null : site].filter(Boolean).join(' · ')
}

export default function SearchView({ socket }: { socket: Socket | null }) {
  const { device } = useShell()
  const phone = device === 'phone'
  const [state, setState] = useState<SearchState>(lastSearch)
  const [input, setInput] = useState(lastSearch.query)
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<SearchResult | null>(null)
  const idRef = useRef(state.searchId)
  useEffect(() => { lastSearch = state; idRef.current = state.searchId }, [state])

  useEffect(() => {
    if (!socket) return
    const onResult = ({ searchId, result }: { searchId: string; source: DownloadSource; result: SearchResult }) => {
      if (searchId !== idRef.current) return
      setState((s) => (s.results.some((r) => r.id === result.id) ? s : { ...s, results: [...s.results, result] }))
    }
    const onDone = ({ searchId, source, count, error }: { searchId: string; source: DownloadSource; count: number; error: string | null }) => {
      if (searchId !== idRef.current) return
      setState((s) => ({ ...s, sources: { ...s.sources, [source]: { done: true, count, error } } }))
    }
    socket.on('download:search_result', onResult)
    socket.on('download:search_done', onDone)
    return () => { socket.off('download:search_result', onResult); socket.off('download:search_done', onDone) }
  }, [socket])

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    const q = input.trim()
    if (q.length < 2) return
    try {
      const { searchId, sources } = await downloadsService.search(q)
      idRef.current = searchId
      setState({ query: q, searchId, results: [], sources: Object.fromEntries(sources.map((src) => [src, { done: false, count: 0, error: null }])) })
    } catch {
      toast.error('La recherche n’a pas pu démarrer.')
    }
  }

  const sources = Object.entries(state.sources) as [DownloadSource, SourceState][]
  const pending = sources.filter(([, s]) => !s.done)
  const failed = sources.filter(([, s]) => s.done && s.error)
  // Fixed order whatever script answers first; arrival order inside a group
  const shown = useMemo(() => state.results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => filter === 'all' || r.kind === filter)
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => r), [state.results, filter])
  const posters = shown.filter((r) => r.kind !== 'youtube')
  const videos = shown.filter((r) => r.kind === 'youtube')
  const counts = useMemo(() => {
    const c: Partial<Record<Filter, number>> = { all: state.results.length }
    for (const r of state.results) c[r.kind] = (c[r.kind] ?? 0) + 1
    return c
  }, [state.results])

  const field = (
    <form onSubmit={submit} className={cn('relative flex items-center', phone ? 'w-full' : 'w-full max-w-[520px]')} role="search">
      <Search size={phone ? 16 : 14} strokeWidth={1.75} className="absolute left-2.5 text-label2 pointer-events-none" aria-hidden="true" />
      <input
        type="search" value={input} onChange={(e) => setInput(e.target.value)} enterKeyHint="search"
        placeholder="Anime, manga, film, série, vidéo YouTube…" aria-label="Rechercher un titre à télécharger"
        className={cn('w-full bg-fill text-label placeholder:text-label2 outline-none focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_35%,transparent)]',
          phone ? 'h-9 pl-8 pr-8 rounded-[10px] text-[17px]' : 'h-8 pl-8 pr-8 rounded-[8px] text-body')}
      />
      {input && (
        <button type="button" className="absolute right-2 w-5 h-5 grid place-items-center rounded-full bg-label3 text-surface"
          onClick={() => setInput('')} aria-label="Effacer"><X size={11} strokeWidth={2.5} /></button>
      )}
    </form>
  )

  const filterBar = phone ? (
    <div className="-mx-4 px-4 flex gap-2 overflow-x-auto scrollbar-none" role="radiogroup" aria-label="Type">
      {FILTERS.map((f) => (
        <button key={f.value} type="button" role="radio" aria-checked={filter === f.value} onClick={() => setFilter(f.value)}
          className={cn('h-8 px-3.5 rounded-full text-subhead font-medium whitespace-nowrap flex-shrink-0',
            filter === f.value ? 'bg-label text-bg' : 'bg-fill text-label')}>
          {f.label}{counts[f.value] ? <span className="ml-1 opacity-60 tabular">{counts[f.value]}</span> : null}
        </button>
      ))}
    </div>
  ) : (
    <SegmentedControl<Filter> label="Type" value={filter} onChange={setFilter}
      options={FILTERS.map((f) => ({ value: f.value, label: <>{f.label}{counts[f.value] ? <span className="ml-1 text-label2 tabular">{counts[f.value]}</span> : null}</> }))} />
  )

  let body: React.ReactNode
  if (!state.searchId) {
    body = (
      <div className="flex flex-col items-center gap-2">
        <EmptyState icon={<DownloadIcon strokeWidth={1.25} />} title="Rechercher un titre"
          message="Une seule recherche interroge anime-sama, movix, le site de films et YouTube en même temps." />
        <CatalogueLine />
      </div>
    )
  } else if (shown.length === 0 && pending.length) {
    body = phone
      ? <div className="flex flex-col gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[108px] rounded-[12px]" />)}</div>
      : <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-[2/3] rounded-[8px]" />)}</div>
  } else if (shown.length === 0) {
    body = <EmptyState icon={<Search strokeWidth={1.25} />} title="Aucun résultat"
      message={filter === 'all' ? 'Essaie un autre titre ou une autre orthographe.' : 'Rien dans ce type. Choisis « Tout » pour voir les autres résultats.'} />
  } else if (phone) {
    body = <div className="bg-surface rounded-group overflow-hidden" role="list">{shown.map((r) => <ResultRow key={r.id} r={r} onOpen={() => setOpen(r)} />)}</div>
  } else {
    body = (
      <div className="flex flex-col gap-8">
        {posters.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6">
            {posters.map((r) => <PosterCard key={r.id} r={r} onOpen={() => setOpen(r)} />)}
          </div>
        )}
        {videos.length > 0 && (
          <section aria-label="Vidéos YouTube">
            {posters.length > 0 && <h2 className="text-headline mb-3">YouTube</h2>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-x-4 gap-y-6">
              {videos.map((r) => <VideoCard key={r.id} r={r} onOpen={() => setOpen(r)} />)}
            </div>
          </section>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={cn('flex gap-3', phone ? 'flex-col' : 'flex-col')}>
        {field}
        {state.searchId && filterBar}
      </div>
      {(pending.length > 0 || failed.length > 0) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-label2" aria-live="polite">
          {pending.length > 0 && (
            <span className="inline-flex items-center gap-1.5"><Spinner size={12} />Recherche dans {pending.map(([s]) => SOURCE_LABEL[s]).join(', ')}…</span>
          )}
          {failed.map(([s, st]) => <span key={s}>{SOURCE_LABEL[s]} : {st.error}</span>)}
        </p>
      )}
      {body}
      <DetailSheet result={open} onClose={() => setOpen(null)} />
    </div>
  )
}

/** anime-sama's catalogue: how many titles, when it was rebuilt, rebuild now. */
function CatalogueLine() {
  const { data, refetch } = useQuery({
    queryKey: ['dl-catalogue'], queryFn: downloadsService.catalogue, refetchInterval: (q) => (q.state.data?.refreshing ? 5000 : false),
  })
  if (!data) return null
  const date = data.updatedAt ? new Date(data.updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null
  return (
    <p className="text-caption text-label2 text-center px-4">
      Catalogue anime-sama : {data.count.toLocaleString('fr-FR')} titres{date ? `, mis à jour le ${date}` : ''} · actualisé chaque semaine
      {data.last?.added ? ` · ${data.last.added} nouveau${data.last.added > 1 ? 'x' : ''} titre${data.last.added > 1 ? 's' : ''}` : ''}
      {' · '}
      {data.refreshing
        ? <span className="inline-flex items-center gap-1 align-middle"><Spinner size={10} />Actualisation…</span>
        : <button type="button" className="text-accent-text font-medium" onClick={() => downloadsService.refreshCatalogue().then(() => refetch()).catch(() => toast.error('Actualisation impossible'))}>Actualiser</button>}
    </p>
  )
}

function PosterCard({ r, onOpen }: { r: SearchResult; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group flex flex-col self-start text-left min-w-0 press-soft rounded-[10px]" aria-label={`${r.title}, ${r.kind}`}>
      <Artwork src={r.poster_url} alt="" type={r.kind === 'anime' ? 'anime' : r.kind === 'manga' ? 'manga' : r.kind}
        title={r.title} className="w-full rounded-[8px] transition-transform duration ease-out lg:group-hover:scale-[1.03]" />
      <span className="flex items-center gap-1.5 mt-2"><KindBadge kind={r.kind} />{r.year && <span className="text-caption text-label2 tabular">{r.year}</span>}</span>
      <span className="block mt-1 text-subhead font-medium text-label line-clamp-2">{r.title}</span>
      {subtitleOf(r) && <span className="block text-caption text-label2 truncate">{subtitleOf(r)}</span>}
    </button>
  )
}

function VideoCard({ r, onOpen }: { r: SearchResult; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group flex flex-col self-start text-left min-w-0 press-soft rounded-[10px]" aria-label={r.title}>
      <Artwork src={r.thumbnail_url ?? r.poster_url} alt="" ratio="16 / 9" type="youtube" title={r.title} cover
        className="w-full rounded-[8px] transition-transform duration ease-out lg:group-hover:scale-[1.02]">
        {r.duration ? <span className="absolute right-1.5 bottom-1.5 px-1.5 py-[1px] rounded-[4px] text-[11px] font-semibold text-white tabular" style={{ background: 'rgba(0,0,0,.75)' }}>{formatDuration(r.duration)}</span> : null}
      </Artwork>
      <span className="block mt-2 text-subhead font-medium text-label line-clamp-2">{r.title}</span>
      <span className="flex items-center gap-1.5 mt-0.5 text-caption text-label2 min-w-0"><KindBadge kind="youtube" /><span className="truncate">{r.channel}</span></span>
    </button>
  )
}

function ResultRow({ r, onOpen }: { r: SearchResult; onOpen: () => void }) {
  const video = r.kind === 'youtube'
  return (
    <button type="button" role="listitem" onClick={onOpen}
      className="nx-row nx-row-inset relative w-full flex items-center gap-3 px-4 py-2.5 text-left pressable">
      <Artwork src={video ? r.thumbnail_url ?? r.poster_url : r.poster_url} alt="" ratio={video ? '16 / 9' : '2 / 3'} type={r.kind} cover={video}
        className={cn('flex-shrink-0 rounded-[6px]', video ? 'w-[128px]' : 'w-[60px]')}>
        {video && r.duration ? <span className="absolute right-1 bottom-1 px-1 rounded-[3px] text-[10px] font-semibold text-white tabular" style={{ background: 'rgba(0,0,0,.75)' }}>{formatDuration(r.duration)}</span> : null}
      </Artwork>
      <span className="flex-1 min-w-0">
        <span className="block text-[17px] leading-snug text-label line-clamp-2">{r.title}</span>
        <span className="flex items-center gap-1.5 mt-1 text-subhead text-label2 min-w-0">
          <KindBadge kind={r.kind} />
          <span className="truncate">{[r.year, subtitleOf(r)].filter(Boolean).join(' · ')}</span>
        </span>
      </span>
    </button>
  )
}
