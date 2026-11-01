import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Search, X, Film } from 'lucide-react'
import { mediaService } from '@/services/mediaService'
import { useDebounce } from '@/hooks/useDebounce'
import type { MediaItem, MediaType } from '@/types'
import Hero from './Hero'
import MediaRow, { type RowItem } from './MediaRow'
import MediaCard from './MediaCard'
import { MEDIA_GRID } from './layout'
import toast from 'react-hot-toast'

export interface BrowserTab {
  key:       string
  label:     string
  icon?:     React.ReactNode
  type:      MediaType
  /** Value for POST /media/scan/:type */
  scanType:  string
  noun:      string
}

interface Props {
  title:      string
  tabs:       BrowserTab[]
  yearFilter?: boolean
  emptyIcon?: React.ReactNode
}

/** Pick a featured title that changes once a day (prefers artwork + synopsis). */
function pickFeatured(items: MediaItem[]): MediaItem | undefined {
  const pool = items.filter((i) => i.backdropPath && i.overview)
  const list = pool.length ? pool : items.filter((i) => i.posterPath || i.backdropPath)
  if (!list.length) return items[0]
  const day = Math.floor(Date.now() / 86_400_000)
  return list[day % list.length]
}

/** Netflix-style catalogue: billboard, then rows (continue, recent, top rated, genres). */
export default function MediaBrowser({ title, tabs, yearFilter, emptyIcon }: Props) {
  const qc = useQueryClient()
  const [tabKey,   setTabKey]   = useState(tabs[0].key)
  const [search,   setSearch]   = useState('')
  const [genre,    setGenre]    = useState('')
  const [year,     setYear]     = useState('')
  const [page,     setPage]     = useState(1)
  const [scanning, setScanning] = useState(false)

  const tab  = tabs.find((t) => t.key === tabKey) ?? tabs[0]
  const type = tab.type
  const isVideo = type !== 'manga' && type !== 'webtoon'
  const debouncedSearch = useDebounce(search, 400)
  const hasFilters = !!(debouncedSearch || genre || year)

  // Whole catalogue of this type (newest first) → hero + rows are built client-side
  const { data: catalog, isLoading } = useQuery({
    queryKey: ['media', 'catalog', type],
    queryFn:  () => mediaService.getAll({ type, limit: 300, sortBy: 'created_at', sortDir: 'desc' }),
  })

  const { data: continueW } = useQuery({
    queryKey: ['media', 'continue'],
    queryFn:  mediaService.getContinueWatching,
    enabled:  isVideo,
  })

  const { data: genres } = useQuery({
    queryKey: ['media', 'genres', type],
    queryFn:  () => mediaService.getGenres(type),
  })

  const { data: tmdbStatus } = useQuery({
    queryKey: ['media', 'metadata-status'],
    queryFn:  mediaService.getMetadataStatus,
    enabled:  type !== 'manga' && type !== 'anime',
    staleTime: 5 * 60_000,
  })

  const { data: filtered, isLoading: loadFiltered } = useQuery({
    queryKey: ['media', 'list', type, debouncedSearch, genre, year, page],
    queryFn:  () => mediaService.getAll({
      type,
      search: debouncedSearch || undefined,
      genre:  genre || undefined,
      year:   year ? parseInt(year) : undefined,
      page,
      limit:  30,
    }),
    enabled: hasFilters,
  })

  const items = useMemo(() => catalog?.items ?? [], [catalog])
  const featured = useMemo(() => pickFeatured(items), [items])

  const continueRow: RowItem[] = useMemo(() => (continueW ?? [])
    .filter((w) => w.type === type)
    .map((w) => ({
      item:     w as unknown as MediaItem,
      progress: w.progress,
      duration: w.duration ?? undefined,
      subtitle: w.episodeNumber != null ? `S${w.season ?? 1} · É${w.episodeNumber}` : undefined,
    })), [continueW, type])

  const topRated = useMemo(() => items
    .filter((i) => i.rating != null && Number(i.rating) > 0)
    .sort((a, b) => Number(b.rating) - Number(a.rating))
    .slice(0, 20), [items])

  // Genre rows: the 8 most common genres with at least 3 titles
  const genreRows = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of items) for (const g of i.genres ?? []) counts.set(g, (counts.get(g) ?? 0) + 1)
    return [...counts.entries()]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([g]) => ({ genre: g, items: items.filter((i) => i.genres?.includes(g)).slice(0, 24) }))
  }, [items])

  async function scan() {
    setScanning(true)
    try {
      await mediaService.scan(tab.scanType)
      toast.success('Scan lancé en arrière-plan')
      setTimeout(() => qc.invalidateQueries({ queryKey: ['media'] }), 4000)
    } catch { toast.error('Erreur scan') }
    finally { setScanning(false) }
  }

  function clear() { setSearch(''); setGenre(''); setYear(''); setPage(1) }
  function showGenre(g: string) { setGenre(g); setPage(1); window.scrollTo?.({ top: 0 }) }

  return (
    <div className="min-h-full" style={{ background: 'var(--bg)' }}>

      {/* ── Header: title, tabs, search & filters ── */}
      <div className="px-4 sm:px-6 lg:px-7 pt-4 sm:pt-6 pb-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="text-[22px] sm:text-[26px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>{title}</h1>

          {tabs.length > 1 && (
            <div className="flex gap-1.5" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={t.key === tabKey}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition-all"
                  style={{
                    background: t.key === tabKey ? 'var(--text)' : 'transparent',
                    color:      t.key === tabKey ? 'var(--bg)'   : 'var(--text2)',
                    border:     `1px solid ${t.key === tabKey ? 'var(--text)' : 'var(--border2)'}`,
                  }}
                  onClick={() => { setTabKey(t.key); clear() }}
                >
                  {t.icon}{t.label}
                </button>
              ))}
            </div>
          )}

          <button className="btn-ghost text-[12.5px] ml-auto" onClick={scan} disabled={scanning} aria-label="Scanner">
            <RefreshCw size={13} strokeWidth={2} className={scanning ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Scanner</span>
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-full sm:w-64">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text3)' }} strokeWidth={2} />
            <input
              className="input pl-8 py-2 text-[13px] w-full"
              placeholder={`Rechercher ${tab.noun}…`}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
            {search && (
              <button className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1" onClick={() => { setSearch(''); setPage(1) }} aria-label="Effacer la recherche">
                <X size={12} style={{ color: 'var(--text3)' }} />
              </button>
            )}
          </div>

          {genres && genres.length > 0 && (
            <select
              className="input py-2 text-[13px] flex-1 min-w-0 sm:flex-none sm:w-44"
              value={genre}
              onChange={(e) => { setGenre(e.target.value); setPage(1) }}
              aria-label="Genre"
            >
              <option value="">Tous les genres</option>
              {genres.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          )}

          {yearFilter && (
            <input
              className="input py-2 text-[13px] w-24 flex-shrink-0"
              type="number" inputMode="numeric" placeholder="Année" min="1900" max="2100"
              value={year}
              onChange={(e) => { setYear(e.target.value); setPage(1) }}
              aria-label="Année"
            />
          )}

          {hasFilters && (
            <button className="btn-ghost text-[12px]" onClick={clear}>
              <X size={13} strokeWidth={2} /> Effacer
            </button>
          )}
        </div>

        {tmdbStatus && !tmdbStatus.tmdb && (
          <p className="text-[12px] px-3 py-2 rounded-lg" style={{ background: 'var(--orange-dim)', color: 'var(--orange)' }}>
            Clé TMDB absente sur le serveur : les affiches et synopsis ne peuvent pas être récupérés.
            Ajoute <span className="font-mono">TMDB_API_KEY</span> dans <span className="font-mono">backend/.env</span> puis relance un scan.
          </p>
        )}
      </div>

      <div className="px-4 sm:px-6 lg:px-7 pb-12">
        {hasFilters ? (
          /* ── Results grid ── */
          <div>
            <p className="text-[13px] mb-4" style={{ color: 'var(--text3)' }}>
              {genre && !debouncedSearch && !year ? <><span className="font-semibold" style={{ color: 'var(--text)' }}>{genre}</span> · </> : null}
              {filtered?.total ?? 0} résultat(s)
            </p>
            {loadFiltered ? (
              <div className={MEDIA_GRID}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="aspect-[2/3] rounded-lg animate-pulse" style={{ background: 'var(--surface2)' }} />
                ))}
              </div>
            ) : filtered && filtered.items.length > 0 ? (
              <>
                <div className={MEDIA_GRID}>
                  {filtered.items.map((item) => <MediaCard key={item.id} item={item} variant="grid" />)}
                </div>
                {filtered.totalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 mt-8">
                    <button className="btn-ghost text-[12px]" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Précédent</button>
                    <span className="text-[12px] font-mono" style={{ color: 'var(--text3)' }}>{page} / {filtered.totalPages}</span>
                    <button className="btn-ghost text-[12px]" disabled={page === filtered.totalPages} onClick={() => setPage((p) => p + 1)}>Suivant →</button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <Search size={28} strokeWidth={1.5} style={{ color: 'var(--text3)' }} />
                <p className="text-[13px]" style={{ color: 'var(--text3)' }}>Aucun résultat</p>
              </div>
            )}
          </div>
        ) : !isLoading && items.length === 0 ? (
          /* ── Empty library ── */
          <div className="flex flex-col items-center justify-center h-60 gap-3 text-center">
            {emptyIcon ?? <Film size={48} strokeWidth={1} style={{ color: 'var(--text3)' }} />}
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Bibliothèque vide</p>
            <p className="text-[12px]" style={{ color: 'var(--text3)' }}>Lance un scan pour indexer tes fichiers</p>
            <button className="btn-primary text-[13px]" onClick={scan} disabled={scanning}>
              <RefreshCw size={13} strokeWidth={2} /> Scanner maintenant
            </button>
          </div>
        ) : (
          /* ── Browse: billboard + rows ── */
          <>
            {featured && <Hero item={featured} />}
            {continueRow.length > 0 && <MediaRow title="Reprendre" items={continueRow} />}
            <MediaRow title="Ajouts récents" items={items.slice(0, 24)} isLoading={isLoading} />
            {topRated.length >= 3 && <MediaRow title="Les mieux notés" items={topRated} />}
            {genreRows.map((r) => (
              <MediaRow key={r.genre} title={r.genre} items={r.items} onSeeAll={() => showGenre(r.genre)} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
