import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, LayoutGrid, List, MoreHorizontal, RotateCw, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { mediaService } from '@/services/mediaService'
import { useDebounce } from '@/hooks/useDebounce'
import { useAuthStore } from '@/stores/authStore'
import type { MediaItem, MediaType } from '@/types'
import Page from '@/components/shell/Page'
import { useShell } from '@/components/shell/shellContext'
import SegmentedControl from '@/components/ui/SegmentedControl'
import DownloadsButton from '@/components/downloads/DownloadsButton'
import Button from '@/components/ui/Button'
import SearchField from '@/components/ui/SearchField'
import EmptyState from '@/components/ui/EmptyState'
import Skeleton from '@/components/ui/Skeleton'
import Sheet from '@/components/ui/Sheet'
import { Group, ListRow } from '@/components/ui/GroupedList'
import Hero from './Hero'
import MediaRow, { type RowItem } from './MediaRow'
import MediaCard from './MediaCard'
import MediaList from './MediaList'
import { MEDIA_GRID } from './layout'
import { VIDEO_SECTIONS, SectionMenu, SearchButton, SearchBarOpen } from './PhoneLibraryBar'
import { useContextMenu } from '@/components/ui/useContextMenu'
import { useFavorites } from '@/hooks/useFavorites'

export interface BrowserTab {
  key:       string
  label:     string
  type:      MediaType
  /** Value for POST /media/scan/:type */
  scanType:  string
  noun:      string
}

interface Props {
  title:       string
  tabs:        BrowserTab[]
  yearFilter?: boolean
  emptyIcon?:  React.ReactNode
  /** Phone: Films · Séries · Animes switch at the top of the "Médias" tab */
  videoSwitch?: boolean
  /** Apple Books presentation (manga): no billboard, book covers with their title */
  books?: boolean
}

type View = 'grid' | 'list'

/** IMDb's weighted rating: v/(v+m)·R + m/(v+m)·C (m = 25 000 votes, C = 7.0) */
function imdbScore(i: MediaItem) {
  const v = i.imdbVotes ?? 0, R = i.imdbRating ?? 0, m = 25_000, C = 7.0
  return (v / (v + m)) * R + (m / (v + m)) * C
}
const VIEW_KEY = 'nexus-media-view'
const readView = (): View => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid' } catch { return 'grid' } }

/** Titles for the billboard: up to 6, with artwork + synopsis first, starting point changing each day. */
function pickFeatured(items: MediaItem[]): MediaItem[] {
  const pool = items.filter((i) => i.backdropPath && i.overview)
  const list = pool.length >= 3 ? pool : items.filter((i) => i.posterPath || i.backdropPath)
  if (!list.length) return items.slice(0, 1)
  const day = Math.floor(Date.now() / 86_400_000)
  const start = day % list.length
  return [...list.slice(start), ...list.slice(0, start)].slice(0, 6)
}

export { VIDEO_SECTIONS }

/** Films / Séries / Animes / YouTube: one switch, same place on every video page. */
export function VideoSectionSwitch({ value, full }: { value: string; full?: boolean }) {
  const navigate = useNavigate()
  return (
    <SegmentedControl full={full} label="Section" value={value}
      onChange={(v) => navigate(VIDEO_SECTIONS.find((s) => s.value === v)!.to)}
      options={VIDEO_SECTIONS.map(({ value: v, label }) => ({ value: v, label }))} />
  )
}

/** Library like the TV app: featured title, shelves; poster grid or detailed list. */
export default function MediaBrowser({ title, tabs, yearFilter, emptyIcon, videoSwitch, books }: Props) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { device } = useShell()
  const phone = device === 'phone'
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const [params, setParams] = useSearchParams()

  const tab = tabs.find((t) => t.key === params.get('type')) ?? tabs[0]
  const type = tab.type
  const isVideo = type !== 'manga' && type !== 'webtoon'

  const [search,   setSearch]   = useState('')
  const [genre,    setGenre]    = useState('')
  const [year,     setYear]     = useState('')
  const [page,     setPage]     = useState(1)
  const [scanning, setScanning] = useState(false)
  const [view,     setViewRaw]  = useState<View>(readView)
  const [filters,  setFilters]  = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const more = useContextMenu()
  const debouncedSearch = useDebounce(search, 400)
  const hasFilters = !!(debouncedSearch || genre || year)

  const setView = (v: View) => { setViewRaw(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode */ } }
  const clear = () => { setSearch(''); setGenre(''); setYear(''); setPage(1) }
  useEffect(() => { clear() }, [type])

  // Whole catalogue of this type (newest first) → featured + shelves are built client-side
  const { data: catalog, isLoading, isError } = useQuery({
    queryKey: ['media', 'catalog', type],
    queryFn:  () => mediaService.getAll({ type, limit: 300, sortBy: 'created_at', sortDir: 'desc' }),
  })
  const { data: continueW } = useQuery({ queryKey: ['media', 'continue'], queryFn: mediaService.getContinueWatching, enabled: isVideo })
  const { data: genres } = useQuery({ queryKey: ['media', 'genres', type], queryFn: () => mediaService.getGenres(type) })
  const { data: tmdbStatus } = useQuery({
    queryKey: ['media', 'metadata-status'], queryFn: mediaService.getMetadataStatus,
    enabled: type !== 'manga' && type !== 'anime', staleTime: 5 * 60_000,
  })
  const { data: filtered, isLoading: loadFiltered } = useQuery({
    queryKey: ['media', 'list', type, debouncedSearch, genre, year, page],
    queryFn:  () => mediaService.getAll({
      type, search: debouncedSearch || undefined, genre: genre || undefined,
      year: year ? parseInt(year) : undefined, page, limit: 30,
    }),
    enabled: hasFilters,
  })

  const items = useMemo(() => catalog?.items ?? [], [catalog])
  const favorites = useFavorites()
  const myList = useMemo(() => favorites.items.filter((m) => m.type === type || (books && m.type === 'webtoon')), [favorites.items, type, books])
  const featured = useMemo(() => pickFeatured(items), [items])
  const continueRow: RowItem[] = useMemo(() => (continueW ?? [])
    .filter((w) => w.type === type)
    .map((w) => ({
      item: w as unknown as MediaItem, progress: w.progress, duration: w.duration ?? undefined,
      subtitle: w.episodeNumber != null ? `S${w.season ?? 1}, É${w.episodeNumber}` : undefined,
    })), [continueW, type])
  // Top 10: IMDb's score when the titles have one (weighted like IMDb's Top 250, so
  // a 9.0 with 40 votes does not beat an 8.6 with 1 million), else TMDB's rating
  const topRated = useMemo(() => {
    const imdb = items.filter((i) => i.imdbRating != null && (i.imdbVotes ?? 0) > 0)
    if (!books && imdb.length >= 3) return [...imdb].sort((a, b) => imdbScore(b) - imdbScore(a)).slice(0, 10)
    return items
      .filter((i) => i.rating != null && Number(i.rating) > 0)
      .sort((a, b) => Number(b.rating) - Number(a.rating))
      .slice(0, 10)
  }, [items, books])
  const genreRows = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of items) for (const g of i.genres ?? []) counts.set(g, (counts.get(g) ?? 0) + 1)
    return [...counts.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([g]) => ({ genre: g, items: items.filter((i) => i.genres?.includes(g)).slice(0, 24) }))
  }, [items])

  async function scan() {
    setScanning(true)
    try {
      await mediaService.scan(tab.scanType)
      toast.success('Analyse lancée : les nouveaux titres apparaissent dans quelques instants.')
      setTimeout(() => qc.invalidateQueries({ queryKey: ['media'] }), 4000)
    } catch { toast.error('L’analyse n’a pas pu démarrer.') }
    finally { setScanning(false) }
  }
  const showGenre = (g: string) => { setGenre(g); setPage(1); document.getElementById('main')?.scrollTo?.({ top: 0 }); window.scrollTo?.({ top: 0 }) }

  /* ── Chrome ─────────────────────────────────────────────────────────── */
  const viewSwitch = (
    <SegmentedControl<View>
      label="Présentation"
      value={view}
      onChange={setView}
      options={[
        { value: 'grid', label: <LayoutGrid size={14} strokeWidth={1.75} aria-label="Affiches" />, title: 'Affiches' },
        { value: 'list', label: <List size={14} strokeWidth={1.75} aria-label="Liste" />, title: 'Liste' },
      ]}
    />
  )
  const searchField = (
    <SearchField
      value={search} onChange={(v) => { setSearch(v); setPage(1) }}
      label={`Rechercher ${tab.noun}`} placeholder={`Rechercher ${tab.noun}`}
      className={phone ? 'w-full' : 'w-[200px]'}
    />
  )
  const genreSelect = genres && genres.length > 0 && (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Genre</span>
      <select
        value={genre}
        onChange={(e) => { setGenre(e.target.value); setPage(1) }}
        className="appearance-none h-7 pl-2.5 pr-7 rounded-[7px] bg-fill text-body text-label outline-none hoverable"
        aria-label="Genre"
      >
        <option value="">Tous les genres</option>
        {genres.map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
      <span className="absolute right-2 pointer-events-none text-label2 text-[10px]" aria-hidden="true">▾</span>
    </label>
  )
  const yearField = yearFilter && (
    <input
      className="h-7 w-[84px] px-2.5 rounded-[7px] bg-fill text-body text-label placeholder:text-label2 outline-none tabular"
      type="number" inputMode="numeric" placeholder="Année" min="1900" max="2100"
      value={year} onChange={(e) => { setYear(e.target.value); setPage(1) }} aria-label="Année"
    />
  )

  const desktopActions = (
    <>
      {searchField}
      {viewSwitch}
      {isAdmin && (
        <button type="button" className="w-8 h-8 grid place-items-center rounded-full text-label2 hoverable disabled:opacity-40" onClick={scan} disabled={scanning} aria-label="Analyser la bibliothèque" title="Analyser la bibliothèque">
          <RotateCw size={16} strokeWidth={1.5} className={scanning ? 'animate-spin' : ''} />
        </button>
      )}
    </>
  )
  const sectionValue = type === 'anime' ? 'animes' : tab.key
  const closeSearch = () => { setSearchOpen(false); setSearch(''); setPage(1) }
  const phoneActions = searchOpen ? undefined : (
    <>
      <SearchButton onOpen={() => setSearchOpen(true)} label={`Rechercher ${tab.noun}`} />
      <DownloadsButton />
      <button
        type="button"
        className="relative w-11 h-11 grid place-items-center rounded-full text-label active:opacity-50"
        aria-label="Plus d’options"
        title="Plus d’options"
        onClick={(e) => more.openFrom(e.currentTarget, [
          { label: view === 'grid' ? 'Afficher en liste' : 'Afficher les affiches', onSelect: () => setView(view === 'grid' ? 'list' : 'grid') },
          { label: hasFilters && (genre || year) ? 'Filtres (actifs)…' : 'Filtres…', onSelect: () => setFilters(true) },
          ...(isAdmin ? [{ label: 'Analyser la bibliothèque', onSelect: () => void scan() }] : []),
        ])}
      >
        <MoreHorizontal size={22} strokeWidth={2} />
        {(genre || year) && <span className="absolute top-2.5 right-2 w-2 h-2 rounded-full bg-accent" aria-hidden="true" />}
      </button>
    </>
  )
  const phoneSearch = searchOpen
    ? <SearchBarOpen value={search} onChange={(v) => { setSearch(v); setPage(1) }} onClose={closeSearch} placeholder={`Rechercher ${tab.noun}`} />
    : undefined

  const accessory = phone ? (
    // iPhone: categories of a tab without the section menu (e.g. none for manga today)
    !videoSwitch && tabs.length > 1 ? (
      <SegmentedControl full label="Catégorie" value={tab.key}
        onChange={(k) => setParams(k === tabs[0].key ? {} : { type: k })}
        options={tabs.map((t) => ({ value: t.key, label: t.label }))} />
    ) : undefined
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      {videoSwitch && <VideoSectionSwitch value={type === 'anime' ? 'animes' : tab.key} />}
      {!videoSwitch && tabs.length > 1 && (
        <SegmentedControl label="Catégorie" value={tab.key}
          onChange={(k) => setParams(k === tabs[0].key ? {} : { type: k })}
          options={tabs.map((t) => ({ value: t.key, label: t.label }))} />
      )}
      {genreSelect}
      {yearField}
      {hasFilters && <Button variant="plain" size="small" onClick={clear}>Effacer les filtres</Button>}
    </div>
  )

  const showHero = !books && view === 'grid' && !hasFilters && !searchOpen && !isError && featured.length > 0
  const shelf = books ? 'book' as const : undefined

  /* ── Content ────────────────────────────────────────────────────────── */
  let content: React.ReactNode
  if (isError) {
    content = <EmptyState tone="error" icon={<AlertTriangle strokeWidth={1.25} />} title="Bibliothèque indisponible" message="Le serveur n’a pas répondu. Vérifie qu’il tourne, puis recharge la page." />
  } else if (hasFilters) {
    content = (
      <div>
        <p className="text-subhead text-label2 mb-4" aria-live="polite">
          {genre && !debouncedSearch && !year ? <><span className="text-label font-medium">{genre}</span> · </> : null}
          {filtered ? `${filtered.total} résultat${filtered.total > 1 ? 's' : ''}` : 'Recherche…'}
        </p>
        {loadFiltered ? (
          <div className={MEDIA_GRID}>{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="aspect-[2/3] rounded-[8px]" />)}</div>
        ) : filtered && filtered.items.length > 0 ? (
          <>
            {view === 'list' ? <MediaList items={filtered.items} /> : (
              <div className={MEDIA_GRID}>{filtered.items.map((item) => <MediaCard key={item.id} item={item} variant="grid" />)}</div>
            )}
            {filtered.totalPages > 1 && (
              <nav className="flex items-center justify-center gap-3 mt-8" aria-label="Pages">
                <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Précédent</Button>
                <span className="text-subhead text-label2 tabular">Page {page} sur {filtered.totalPages}</span>
                <Button disabled={page === filtered.totalPages} onClick={() => setPage((p) => p + 1)}>Suivant</Button>
              </nav>
            )}
          </>
        ) : (
          <EmptyState icon={<Search strokeWidth={1.25} />} title="Aucun résultat" message="Essaie un autre titre, ou retire un filtre." action={<Button variant="plain" onClick={clear}>Effacer les filtres</Button>} />
        )}
      </div>
    )
  } else if (!isLoading && items.length === 0) {
    content = (
      <EmptyState
        icon={emptyIcon}
        title="Bibliothèque vide"
        message={`Ajoute des fichiers dans le dossier du serveur, puis lance une analyse pour les voir ici.`}
        action={isAdmin && <Button variant="primary" icon={<RotateCw size={14} strokeWidth={1.75} />} loading={scanning} onClick={scan}>Analyser la bibliothèque</Button>}
      />
    )
  } else if (view === 'list') {
    content = isLoading ? <Skeleton className="h-64 rounded-card" /> : <MediaList items={items} />
  } else {
    content = (
      <>
        {continueRow.length > 0 && <MediaRow title="Reprendre" items={continueRow} kind="wide" />}
        {myList.length > 0 && <MediaRow title="Ma liste" items={myList} onSeeAll={() => navigate('/ma-liste')} kind={shelf} />}
        <MediaRow title={books ? 'Nouveautés' : 'Ajouts récents'} items={items.slice(0, 24)} isLoading={isLoading} kind={shelf} />
        {topRated.length >= 3 && <MediaRow title={books ? 'Les mieux notés' : 'Top 10'} items={topRated} kind={books ? 'book' : 'top10'} />}
        {genreRows.map((r) => <MediaRow key={r.genre} title={r.genre} items={r.items} onSeeAll={() => showGenre(r.genre)} kind={shelf} />)}
      </>
    )
  }

  return (
    <Page
      title={title}
      subtitle={catalog ? `${catalog.total} titre${catalog.total > 1 ? 's' : ''}` : undefined}
      actions={phone ? phoneActions : desktopActions}
      accessory={accessory}
      largeTitle={!phone}
      barTitle={!phone}
      leading={phone && videoSwitch ? <SectionMenu value={sectionValue} /> : undefined}
      barOverride={phone ? phoneSearch : undefined}
      hero={showHero ? <Hero items={featured} /> : undefined}
    >
      {tmdbStatus && !tmdbStatus.tmdb && (
        <div className="flex items-start gap-2.5 mb-6 px-4 py-3 rounded-group bg-surface text-subhead" role="note">
          <AlertTriangle size={16} strokeWidth={1.75} className="text-warn flex-shrink-0 mt-px" aria-hidden="true" />
          <p className="text-label2">
            Les affiches et les synopsis ne peuvent pas être récupérés : la clé TMDB manque sur le serveur.
            Ajoute <span className="font-mono">TMDB_API_KEY</span> dans <span className="font-mono">backend/.env</span>, puis relance une analyse.
          </p>
        </div>
      )}
      {content}
      {more.element}

      {/* Phone: filters in a bottom sheet */}
      <Sheet open={filters} onClose={() => setFilters(false)} title="Filtres" phoneHeader={{
        left: hasFilters ? <Button variant="plain" onClick={clear}>Effacer</Button> : undefined,
        right: <Button variant="plain" className="font-semibold" onClick={() => setFilters(false)}>OK</Button>,
      }}>
        <div className="flex flex-col gap-6 pt-2">
          {yearFilter && (
            <Group header="Année">
              <div className="nx-row relative flex items-center px-4 min-h-row" role="listitem">
                <input className="flex-1 bg-transparent outline-none text-[17px] text-label placeholder:text-label3 tabular" type="number" inputMode="numeric" placeholder="Toutes les années"
                  value={year} onChange={(e) => { setYear(e.target.value); setPage(1) }} aria-label="Année" />
              </div>
            </Group>
          )}
          {genres && genres.length > 0 && (
            <Group header="Genre">
              {['', ...genres].map((g) => (
                <ListRow key={g || 'all'} title={g || 'Tous les genres'} onClick={() => { setGenre(g); setPage(1) }}
                  accessory={genre === g ? <span className="text-accent font-semibold" aria-label="Sélectionné">✓</span> : undefined} />
              ))}
            </Group>
          )}
          {isAdmin && (
            <Group>
              <ListRow title="Analyser la bibliothèque" onClick={() => { setFilters(false); void scan() }} className="text-accent-text" />
            </Group>
          )}
        </div>
      </Sheet>
    </Page>
  )
}
