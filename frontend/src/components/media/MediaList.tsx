import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { MediaItem } from '@/types'
import { useShell } from '@/components/shell/shellContext'
import { Group, ListRow } from '@/components/ui/GroupedList'
import { useContextMenu } from '@/components/ui/useContextMenu'
import { cn, formatDate } from '@/utils'
import Artwork from './Artwork'
import { rating, useMediaActions } from './mediaActions'

type SortKey = 'title' | 'year' | 'genre' | 'rating' | 'added'

/** Detailed list: Finder-like sortable table on desktop, iOS list on phone. */
export default function MediaList({ items }: { items: MediaItem[] }) {
  const { device } = useShell()
  return device === 'phone' ? <PhoneList items={items} /> : <Table items={items} />
}

function PhoneList({ items }: { items: MediaItem[] }) {
  return (
    <Group>
      {items.map((i) => (
        <ListRow
          key={i.id}
          to={`/media/${i.id}`}
          icon={<Artwork src={i.posterPath} alt="" type={i.type} className="w-10 rounded-[4px]" />}
          title={i.title}
          subtitle={[i.year, i.genres?.[0], rating(i.rating) && `${rating(i.rating)} / 10`].filter(Boolean).join(' · ')}
          accessory="chevron"
        />
      ))}
    </Group>
  )
}

function Table({ items }: { items: MediaItem[] }) {
  const navigate = useNavigate()
  const menu = useContextMenu()
  const actions = useMediaActions()
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'title', dir: 1 })
  const [selected, setSelected] = useState<string | null>(null)

  const rows = useMemo(() => {
    const v = (i: MediaItem): string | number => {
      switch (sort.key) {
        case 'title':  return i.title.toLocaleLowerCase('fr')
        case 'year':   return i.year ?? 0
        case 'genre':  return i.genres?.[0] ?? ''
        case 'rating': return Number(i.rating ?? 0)
        case 'added':  return i.createdAt
      }
    }
    return [...items].sort((a, b) => {
      const x = v(a), y = v(b)
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr')) * sort.dir
    })
  }, [items, sort])

  const head = (key: SortKey, label: string, cls = '') => {
    const on = sort.key === key
    return (
      <th scope="col" className={cn('font-normal text-left', cls)} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          className="flex items-center gap-1 w-full px-2 h-7 text-caption text-label2 hoverable rounded-[4px]"
          onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}
        >
          {label}
          {on && (sort.dir === 1 ? <ChevronUp size={12} strokeWidth={2} /> : <ChevronDown size={12} strokeWidth={2} />)}
        </button>
      </th>
    )
  }

  return (
    <div className="bg-surface rounded-card overflow-hidden">
      <table className="w-full text-body border-collapse table-fixed">
        <thead className="hairline-b">
          <tr>
            {head('title', 'Titre', 'w-[44%] pl-2')}
            {head('year', 'Année', 'w-[10%]')}
            {head('genre', 'Genre', 'w-[20%]')}
            {head('rating', 'Note', 'w-[10%]')}
            {head('added', 'Ajouté le', 'w-[16%] pr-2')}
          </tr>
        </thead>
        <tbody>
          {rows.map((i, n) => {
            const sel = selected === i.id
            return (
              <tr
                key={i.id}
                tabIndex={0}
                aria-selected={sel}
                onClick={() => setSelected(i.id)}
                onDoubleClick={() => navigate(`/media/${i.id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/media/${i.id}`) }}
                {...menu.bind(actions(i), i.title)}
                className={cn('h-8 outline-none', sel ? 'bg-accent text-white' : n % 2 ? 'bg-fill2' : '', 'focus-visible:bg-accent-soft')}
              >
                <td className="pl-4 pr-2 truncate">
                  <span className="flex items-center gap-2 min-w-0">
                    <Artwork src={i.posterPath} alt="" type={i.type} className="w-4 rounded-[2px] flex-shrink-0" />
                    <span className="truncate">{i.title}</span>
                  </span>
                </td>
                <td className={cn('px-2 tabular', !sel && 'text-label2')}>{i.year ?? '—'}</td>
                <td className={cn('px-2 truncate', !sel && 'text-label2')}>{i.genres?.slice(0, 2).join(', ') || '—'}</td>
                <td className={cn('px-2 tabular', !sel && 'text-label2')}>{rating(i.rating) ?? '—'}</td>
                <td className={cn('px-2 pr-4 tabular truncate', !sel && 'text-label2')}>{formatDate(i.createdAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {menu.element}
    </div>
  )
}
