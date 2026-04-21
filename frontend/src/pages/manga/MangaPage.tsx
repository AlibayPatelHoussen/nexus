import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, RefreshCw, X, BookOpen } from 'lucide-react'
import { mediaService } from '@/services/mediaService'
import { useDebounce } from '@/hooks/useDebounce'
import MediaCard from '@/components/media/MediaCard'
import MediaRow from '@/components/media/MediaRow'
import toast from 'react-hot-toast'

export default function MangaPage() {
  const qc = useQueryClient()
  const [search,   setSearch]   = useState('')
  const [page,     setPage]     = useState(1)
  const [scanning, setScanning] = useState(false)

  const debouncedSearch = useDebounce(search, 400)
  const hasFilters = !!debouncedSearch

  const { data: recent, isLoading: loadRecent } = useQuery({
    queryKey: ['media', 'recent', 'manga'],
    queryFn:  () => mediaService.getRecent('manga', 16),
    enabled:  !hasFilters,
  })

  const { data: filtered, isLoading: loadFiltered } = useQuery({
    queryKey: ['media', 'list', 'manga', debouncedSearch, page],
    queryFn:  () => mediaService.getAll({
      type:   'manga',
      search: debouncedSearch || undefined,
      page,
      limit:  24,
    }),
    enabled: hasFilters,
  })

  async function scan() {
    setScanning(true)
    try {
      await mediaService.scan('manga')
      toast.success('Scan lancé en arrière-plan')
      setTimeout(() => qc.invalidateQueries({ queryKey: ['media'] }), 4000)
    } catch { toast.error('Erreur scan') }
    finally { setScanning(false) }
  }

  return (
    <div className="min-h-full" style={{ background: 'var(--bg)' }}>
      <div className="sticky top-0 z-40 px-7 pt-6 pb-3" style={{ background: 'var(--bg)' }}>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-[26px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Manga
          </h1>
          <button className="btn-ghost text-[12.5px]" onClick={scan} disabled={scanning}>
            <RefreshCw size={13} strokeWidth={2} className={scanning ? 'animate-spin' : ''} />
            Scanner
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text3)' }} strokeWidth={2} />
            <input
              className="input pl-8 py-2 text-[13px] w-56"
              placeholder="Rechercher un manga…"
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
        </div>
      </div>

      <div className="px-7 pb-10">
        {!hasFilters && (
          <MediaRow title="Bibliothèque manga" items={recent || []} isLoading={loadRecent} />
        )}

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
                <BookOpen size={32} strokeWidth={1.5} style={{ color: 'var(--text3)' }} />
                <p className="text-[13px]" style={{ color: 'var(--text3)' }}>Aucun résultat</p>
              </div>
            )}
          </div>
        )}

        {!hasFilters && !loadRecent && (!recent || recent.length === 0) && (
          <div className="flex flex-col items-center justify-center h-60 gap-3">
            <BookOpen size={48} strokeWidth={1} style={{ color: 'var(--text3)' }} />
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
              Bibliothèque vide
            </p>
            <p className="text-[12px]" style={{ color: 'var(--text3)' }}>
              Placez vos mangas dans /media/scans et lancez un scan
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
