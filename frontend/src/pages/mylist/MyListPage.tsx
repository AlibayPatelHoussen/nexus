import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import Page from '@/components/shell/Page'
import SegmentedControl from '@/components/ui/SegmentedControl'
import EmptyState from '@/components/ui/EmptyState'
import Skeleton from '@/components/ui/Skeleton'
import Button from '@/components/ui/Button'
import MediaCard from '@/components/media/MediaCard'
import { MEDIA_GRID } from '@/components/media/layout'
import { useShell } from '@/components/shell/shellContext'
import { useFavorites } from '@/hooks/useFavorites'
import type { MediaItem } from '@/types'

type Filter = 'all' | 'film' | 'serie' | 'anime' | 'book' | 'youtube'
const FILTERS: { value: Filter; label: string; match: (m: MediaItem) => boolean }[] = [
  { value: 'all',     label: 'Tout',    match: () => true },
  { value: 'film',    label: 'Films',   match: (m) => m.type === 'film' },
  { value: 'serie',   label: 'Séries',  match: (m) => m.type === 'serie' },
  { value: 'anime',   label: 'Animes',  match: (m) => m.type === 'anime' },
  { value: 'book',    label: 'Manga',   match: (m) => m.type === 'manga' || m.type === 'webtoon' },
  { value: 'youtube', label: 'YouTube', match: (m) => m.type === 'youtube' },
]

/** « Ma liste » (Apple TV app): the titles added with « + », newest first, by kind. */
export default function MyListPage() {
  const navigate = useNavigate()
  const { device } = useShell()
  const phone = device === 'phone'
  const { items, isLoading } = useFavorites()
  const [filter, setFilter] = useState<Filter>('all')

  // Only the kinds that are in the list (no empty « Animes » tab)
  const filters = useMemo(() => FILTERS.filter((f) => f.value === 'all' || items.some(f.match)), [items])
  const current = filters.find((f) => f.value === filter) ?? filters[0]
  const shown = items.filter(current.match)

  return (
    <Page
      title="Ma liste"
      subtitle={items.length ? `${items.length} titre${items.length > 1 ? 's' : ''}` : undefined}
      accessory={filters.length > 2 ? (
        <SegmentedControl label="Type" value={current.value} onChange={setFilter} full={phone}
          options={filters.map(({ value, label }) => ({ value, label }))} />
      ) : undefined}
    >
      {isLoading ? (
        <div className={MEDIA_GRID}>
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="w-full aspect-[2/3] rounded-card" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Plus strokeWidth={1.25} />}
          title="Ta liste est vide"
          message="Ajoute des films, des séries, des animes ou des mangas avec le bouton + pour les retrouver ici."
          action={<Button variant="plain" onClick={() => navigate('/cinema')}>Parcourir les films et séries</Button>}
        />
      ) : (
        <div className={MEDIA_GRID}>
          {shown.map((item) => <MediaCard key={item.id} item={item} variant="grid" />)}
        </div>
      )}
    </Page>
  )
}
