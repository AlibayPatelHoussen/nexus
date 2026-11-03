import { useNavigate } from 'react-router-dom'
import { Play, Star } from 'lucide-react'
import type { MediaItem } from '@/types'
import Button from '@/components/ui/Button'
import Artwork from './Artwork'
import { isReading, rating } from './mediaActions'

const TYPE_LABEL: Record<string, string> = {
  film: 'Film', serie: 'Série', anime: 'Anime', manga: 'Manga', webtoon: 'Webtoon',
}

/** Featured title: the artwork shown whole next to (or above) its details. No text over the image. */
export default function Hero({ item }: { item: MediaItem }) {
  const navigate = useNavigate()
  const reading = isReading(item.type)
  const wide = !!item.backdropPath
  const r = rating(item.rating)
  const meta = [TYPE_LABEL[item.type] ?? item.type, item.year, ...(item.genres?.slice(0, 2) ?? [])].filter(Boolean).join(' · ')

  return (
    <section aria-label="À la une" className="mb-8 bg-surface rounded-card overflow-hidden grid md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:items-center">
      <Artwork
        src={item.backdropPath || item.posterPath}
        alt=""
        ratio={wide ? '16 / 9' : '2 / 3'}
        type={item.type}
        title={item.title}
        loading="eager"
        className={wide ? 'w-full' : 'w-[52%] max-w-[260px] mx-auto mt-5 md:my-6 rounded-[8px]'}
      />
      <div className="flex flex-col gap-2 p-5 md:p-7 min-w-0">
        <p className="text-caption text-label2">À la une · {meta}</p>
        <h2 className="text-[26px] md:text-[30px] font-bold tracking-[-0.022em] leading-tight text-label line-clamp-2">{item.title}</h2>
        {r && (
          <p className="flex items-center gap-1 text-subhead text-label2 tabular">
            <Star size={13} strokeWidth={1.75} aria-hidden="true" /> {r} / 10
          </p>
        )}
        {item.overview && <p className="text-callout text-label2 line-clamp-3 max-w-[60ch]">{item.overview}</p>}
        <div className="flex gap-2 mt-3 max-md:flex-col">
          <Button variant="primary" icon={<Play size={14} strokeWidth={0} fill="currentColor" />} className="max-md:min-h-[44px] max-md:text-[17px]"
            onClick={() => navigate(reading ? `/media/${item.id}` : `/player/${item.id}`)}>
            {reading ? 'Lire' : 'Lecture'}
          </Button>
          <Button className="max-md:min-h-[44px] max-md:text-[17px]" onClick={() => navigate(`/media/${item.id}`)}>Plus d’infos</Button>
        </div>
      </div>
    </section>
  )
}
