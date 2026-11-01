import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Info, Play, Star } from 'lucide-react'
import type { MediaItem } from '@/types'

const TYPE_LABEL: Record<string, string> = {
  film: 'Film', serie: 'Série', anime: 'Anime', manga: 'Manga', webtoon: 'Webtoon',
}

/** Netflix-style billboard: full-bleed artwork, title, synopsis, Play / More info. */
export default function Hero({ item }: { item: MediaItem }) {
  const navigate = useNavigate()
  const [imgErr, setImgErr] = useState(false)
  const art = item.backdropPath || item.posterPath
  const isReading = item.type === 'manga' || item.type === 'webtoon'

  function play() {
    // Films play directly; series/anime open the next episode; manga goes to its page
    if (isReading) navigate(`/media/${item.id}`)
    else navigate(`/player/${item.id}`)
  }

  return (
    <section className="relative -mx-4 sm:-mx-6 lg:-mx-7 mb-6 sm:mb-8 overflow-hidden">
      <div className="relative h-[68vh] max-h-[560px] min-h-[380px] sm:h-[440px] lg:h-[500px]">
        {art && !imgErr ? (
          <img
            src={art}
            alt=""
            className={`absolute inset-0 w-full h-full object-cover ${item.backdropPath ? 'object-center' : 'object-top'}`}
            onError={() => setImgErr(true)}
          />
        ) : (
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #2a2a3d, #0a0a0f)' }} />
        )}

        {/* Readability gradients */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.4) 45%, rgba(0,0,0,0.15) 100%)' }} />
        <div className="absolute inset-0 hidden sm:block" style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.25) 50%, transparent 75%)' }} />

        {/* Content */}
        <div className="absolute inset-x-0 bottom-0 px-4 sm:px-6 lg:px-7 pb-6 sm:pb-10 flex flex-col items-center sm:items-start text-center sm:text-left">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] mb-2" style={{ color: 'var(--red)' }}>
            {TYPE_LABEL[item.type] ?? item.type}
          </span>
          <h2 className="text-[30px] sm:text-[40px] lg:text-[48px] font-extrabold tracking-tight leading-[1.05] text-white max-w-2xl line-clamp-2 drop-shadow-lg">
            {item.title}
          </h2>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-3 gap-y-1 mt-2.5 text-[12.5px] sm:text-[13.5px] text-white/80">
            {item.rating != null && Number(item.rating) > 0 && (
              <span className="flex items-center gap-1 font-semibold" style={{ color: 'var(--green)' }}>
                <Star size={12} fill="currentColor" /> {Number(item.rating).toFixed(1)}
              </span>
            )}
            {item.year && <span>{item.year}</span>}
            {item.genres?.slice(0, 3).map((g, i) => (
              <span key={g} className="flex items-center gap-3">
                {(i > 0 || item.year) && <span className="w-1 h-1 rounded-full bg-white/50" />}
                {g}
              </span>
            ))}
          </div>

          {item.overview && (
            <p className="hidden sm:block mt-3 max-w-xl text-[14px] lg:text-[15px] leading-relaxed text-white/85 line-clamp-3 drop-shadow">
              {item.overview}
            </p>
          )}

          <div className="flex items-center gap-2.5 mt-4 sm:mt-5 w-full sm:w-auto">
            <button
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-md text-[14px] sm:text-[15px] font-bold bg-white text-black hover:bg-white/85 transition-colors"
              onClick={play}
            >
              <Play size={18} fill="black" strokeWidth={0} /> {isReading ? 'Lire' : 'Lecture'}
            </button>
            <button
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-md text-[14px] sm:text-[15px] font-bold text-white transition-colors hover:bg-white/30"
              style={{ background: 'rgba(109,109,110,0.7)' }}
              onClick={() => navigate(`/media/${item.id}`)}
            >
              <Info size={18} strokeWidth={2.2} /> Plus d'infos
            </button>
          </div>
        </div>
      </div>
      {/* Soft transition into the page background */}
      <div className="h-6 -mt-px" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.88), var(--bg))' }} />
    </section>
  )
}
