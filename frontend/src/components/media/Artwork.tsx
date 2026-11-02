import { useEffect, useState } from 'react'
import { BookOpen, Film, Tv, Tv2 } from 'lucide-react'
import type { MediaType } from '@/types'

const TYPE_COLORS: Record<string, string> = {
  film: 'var(--red)', serie: 'var(--blue)', anime: 'var(--teal)', manga: 'var(--purple)', webtoon: 'var(--orange)',
}
const TYPE_ICONS: Record<string, typeof Film> = { film: Film, serie: Tv, anime: Tv2, manga: BookOpen, webtoon: BookOpen }

interface ArtworkProps {
  src:        string | null | undefined
  alt:        string
  /** Frame ratio, e.g. "2 / 3" for posters, "16 / 9" for episode stills */
  ratio?:     string
  /** Used by the placeholder (colour, icon) */
  type?:      MediaType | string
  /** Title shown on the placeholder when there is no image */
  title?:     string
  subtitle?:  string | number | null
  className?: string
  /** Rounded corners etc. are set by the caller through className */
  imgClassName?: string
  /** "lazy" for grids/rows, "eager" for the main artwork of a page */
  loading?:   'lazy' | 'eager'
  /** Fill the frame (crop) instead of showing the whole image — only for decorative backgrounds */
  cover?:     boolean
  children?:  React.ReactNode
}

/**
 * Artwork frame shared by cards, title pages, the billboard and episode lists.
 * - keeps the original ratio (object-fit: contain), never stretched or cut;
 * - fills the empty space with a blurred copy of the same image;
 * - shows a clean placeholder when there is no image or it fails to load.
 */
export default function Artwork({
  src, alt, ratio = '2 / 3', type, title, subtitle, className = '', imgClassName = '',
  loading = 'lazy', cover = false, children,
}: ArtworkProps) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  const showImage = !!src && !failed
  const color = TYPE_COLORS[type ?? ''] ?? 'var(--blue)'
  const Icon  = TYPE_ICONS[type ?? ''] ?? Film

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ aspectRatio: ratio, background: 'var(--surface2)' }}
    >
      {showImage ? (
        <>
          {!cover && (
            // Blurred copy filling the space around the contained image
            <img
              src={src!}
              alt=""
              aria-hidden="true"
              loading={loading}
              className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60"
            />
          )}
          <img
            src={src!}
            alt={alt}
            loading={loading}
            className={`relative w-full h-full ${cover ? 'object-cover' : 'object-contain'} ${imgClassName}`}
            onError={() => setFailed(true)}
          />
        </>
      ) : (
        <div
          className="absolute inset-0 flex flex-col justify-end p-2.5"
          style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${color} 35%, var(--surface2)), var(--surface3))` }}
          role="img"
          aria-label={alt}
        >
          <Icon size={22} strokeWidth={1.6} className="absolute top-2.5 left-2.5 opacity-60" style={{ color }} />
          {title && (
            <span className="text-[12px] sm:text-[13px] font-bold leading-tight line-clamp-4" style={{ color: 'var(--text)' }}>
              {title}
            </span>
          )}
          {subtitle != null && subtitle !== '' && (
            <span className="text-[10px] font-mono mt-1" style={{ color: 'var(--text3)' }}>{subtitle}</span>
          )}
        </div>
      )}
      {children}
    </div>
  )
}
