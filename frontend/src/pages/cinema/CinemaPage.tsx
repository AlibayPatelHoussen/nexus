import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, RefreshCw, X, Film, Tv } from 'lucide-react'
import { mediaService } from '@/services/mediaService'
import { useDebounce } from '@/hooks/useDebounce'
import MediaCard from '@/components/media/MediaCard'
import MediaRow from '@/components/media/MediaRow'
import toast from 'react-hot-toast'

type Tab = 'films' | 'series'

export default function CinemaPage() {
  const qc = useQueryClient()
  const [tab,      setTab]      = useState<Tab>('films')
  const [search,   setSearch]   = useState('')
  const [genre,    setGenre]    = useState('')
  const [year,     setYear]     = useState('')
  const [page,     setPage]     = useState(1)
  const [scanning, setScanning] = useState(false)

  const debouncedSearch = useDebounce(search, 400)
  const mediaType = tab === 'films' ? 'film' : 'serie'
  const hasFilters = !!(debouncedSearch || genre || year)

  const { data: recent, isLoading: loadRecent } = useQuery({
    queryKey: ['media', 'recent', mediaType],
    queryFn:  () => mediaService.getRecent(mediaType, 16),
    enabled:  !hasFilters,
  })

  const { data: continueW } = useQuery({
    queryKey: ['media', 'continue'],
    queryFn:  mediaService.getContinueWatching,
    enabled:  !hasFilters,
  })

  const { data: genres } = useQuery({
    queryKey: ['media', 'genres', mediaType],
    queryFn:  () => mediaService.getGenres(mediaType),
  })

  const { data: filtered, isLoading: loadFiltered } = useQuery({
    queryKey: ['media', 'list', mediaType, debouncedSearch, genre, year, page],
    queryFn:  () => mediaService.getAll({
      type:   mediaType,
      search: debouncedSearch || undefined,
      genre:  genre           || undefined,
      year:   year ? parseInt(year) : undefined,
      page,
      limit:  24,
    }),
    enabled: hasFilters,
  })

  async function scan() {
    setScanning(true)
    try {
      await mediaService.scan(tab)
      toast.success('Scan lancé en arrière-plan')
      setTimeout(() => qc.invalidateQueries({ queryKey: ['media'] }), 4000)
    } catch { toast.error('Erreur scan') }
    finally { setScanning(false) }
  }

  function clear() { setSearch(''); setGenre(''); setYear(''); setPage(1) }

  return (
    <div className="min-h-full" style={{ background: 'var(--bg)' }}>

      {/* TOPBAR */}
      <div className="sticky top-0 z-40 px-7 pt-6 pb-3" style={{ background: 'var(--bg)' }}>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-[26px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Cinéma
          </h1>
          <button className="btn-ghost text-[12.5px]" onClick={scan} disabled={scanning}>
            <RefreshCw size={13} strokeWidth={2} className={scanning ? 'animate-spin' : ''} />
            Scanner
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {(['films', 'series'] as Tab[]).map((t) => (
            <button
              key={t}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-semibold transition-all"
              style={{
                background: tab === t ? 'var(--blue)' : 'var(--surface2)',
                color:      tab === t ? 'white'       : 'var(--text2)',
                border:     `1px solid ${tab === t ? 'var(--blue)' : 'var(--border)'}`,
              }}
              onClick={() => { setTab(t); clear() }}
            >
              {t === 'films'
                ? <Film size={13} strokeWidth={2} />
                : <Tv   size={13} strokeWidth={2} />
              }
              {t === 'films' ? 'Films' : 'Séries'}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text3)' }} strokeWidth={2} />
            <input
              className="input pl-8 py-2 text-[13px] w-56"
              placeholder={`Rechercher ${tab === 'films' ? 'un film' : 'une série'}…`}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
            {search && (
              <button className="absolute right-2.5 top-1/2 -translate-y-1/2"
                onClick={() => { setSearch(''); setPage(1) }}>
                <X size={12} style={{ color: 'var(--text3)' }} />
              </button>
            )}
          </div>

          {genres && genres.length > 0 && (
            <select
              className="input py-2 text-[13px] w-36"
              value={genre}
              onChange={(e) => { setGenre(e.target.value); setPage(1) }}
            >
              <option value="">Tous genres</option>
              {genres.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          )}

          <input
            className="input py-2 text-[13px] w-24"
            type="number"
            placeholder="Année"
            min="1900" max="2030"
            value={year}
            onChange={(e) => { setYear(e.target.value); setPage(1) }}
          />

          {(search || genre || year) && (
            <button className="btn-ghost text-[12px]" onClick={clear}>
              <X size={13} strokeWidth={2} /> Effacer
            </button>
          )}
        </div>
      </div>

      {/* CONTENT */}
      <div className="px-7 pb-10">

        {/* Continue watching */}
        {!hasFilters && continueW && continueW.length > 0 && (
          <div className="mb-6">
            <h2 className="text-[15px] font-semibold mb-3" style={{ color: 'var(--text)' }}>
              Continuer la lecture
            </h2>
            <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
              {continueW.map((item: any) => (
                <MediaCard
                  key={item.id}
                  item={{ ...item, posterPath: item.poster_path }}
                  progress={item.progress}
                  duration={item.duration}
                />
              ))}
            </div>
          </div>
        )}

        {!hasFilters && (
          <MediaRow title="Récemment ajoutés" items={recent || []} isLoading={loadRecent} />
        )}

        {/* Filtered grid */}
        {hasFilters && (
          <div>
            <p className="text-[13px] mb-4" style={{ color: 'var(--text3)' }}>
              {filtered?.total ?? 0} résultat(s)
            </p>

            {loadFiltered ? (
              <div className="grid gap-4"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="rounded-xl animate-pulse"
                    style={{ height: '170px', background: 'var(--surface2)' }} />
                ))}
              </div>
            ) : filtered && filtered.items.length > 0 ? (
              <>
                <div className="grid gap-4"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
                  {filtered.items.map((item) => (
                    <MediaCard key={item.id} item={item} />
                  ))}
                </div>

                {filtered.totalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 mt-8">
                    <button className="btn-ghost text-[12px]"
                      disabled={page === 1}
                      onClick={() => setPage((p) => p - 1)}>
                      ← Précédent
                    </button>
                    <span className="text-[12px] font-mono" style={{ color: 'var(--text3)' }}>
                      {page} / {filtered.totalPages}
                    </span>
                    <button className="btn-ghost text-[12px]"
                      disabled={page === filtered.totalPages}
                      onClick={() => setPage((p) => p + 1)}>
                      Suivant →
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <Film size={32} strokeWidth={1.5} style={{ color: 'var(--text3)' }} />
                <p className="text-[13px]" style={{ color: 'var(--text3)' }}>Aucun résultat</p>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!hasFilters && !loadRecent && (!recent || recent.length === 0) && (
          <div className="flex flex-col items-center justify-center h-60 gap-3">
            <Film size={48} strokeWidth={1} style={{ color: 'var(--text3)' }} />
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
              Médiathèque vide
            </p>
            <p className="text-[12px]" style={{ color: 'var(--text3)' }}>
              Lancez un scan pour indexer vos fichiers
            </p>
            <button className="btn-primary text-[13px]" onClick={scan} disabled={scanning}>
              <RefreshCw size={13} strokeWidth={2} /> Scanner maintenant
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
