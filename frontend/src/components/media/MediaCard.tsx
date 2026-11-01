import { useState } from 'react'
import { Heart, Play, Star, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { MediaItem } from '@/types'
import { mediaService } from '@/services/mediaService'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/services/api'
import toast from 'react-hot-toast'

interface MediaCardProps {
  item:       MediaItem
  showType?:  boolean
  progress?:  number
  duration?:  number
  /** Fill the grid cell instead of the fixed 120px used in horizontal rows */
  fluid?:     boolean
}

export default function MediaCard({ item, showType, progress, duration, fluid }: MediaCardProps) {
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const isAdmin   = useAuthStore((s) => s.user?.role === 'admin')
  const [isFav,     setIsFav]     = useState(false)
  const [imgError,  setImgError]  = useState(false)
  const [deleting,  setDeleting]  = useState(false)

  const pct = progress && duration ? Math.round((progress / duration) * 100) : 0

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Supprimer "${item.title}" de la bibliothèque ?`)) return
    setDeleting(true)
    try {
      await api.delete(`/media/${item.id}`)
      toast.success(`"${item.title}" supprimé`)
      qc.invalidateQueries({ queryKey: ['media'] })
    } catch { toast.error('Erreur lors de la suppression') }
    finally { setDeleting(false) }
  }

  async function toggleFav(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      const result = await mediaService.toggleFavorite(item.id)
      setIsFav(result)
      toast.success(result ? 'Ajouté aux favoris' : 'Retiré des favoris')
    } catch { toast.error('Erreur') }
  }

  function handleClick() {
    navigate(`/media/${item.id}`)
  }

  const typeColors: Record<string, string> = {
    film:    'var(--red)',
    serie:   'var(--blue)',
    anime:   'var(--teal)',
    manga:   'var(--purple)',
    webtoon: 'var(--orange)',
  }

  return (
    <div
      className={`${fluid ? 'w-full min-w-0' : 'flex-shrink-0 w-[108px] sm:w-[120px]'} cursor-pointer group`}
      onClick={handleClick}
    >
      {/* Poster */}
      <div
        className="relative w-full aspect-[12/17] rounded-xl overflow-hidden mb-2"
        style={{ background: 'var(--surface2)' }}
      >
        {item.posterPath && !imgError ? (
          <img
            src={item.posterPath}
            alt={item.title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Play size={28} strokeWidth={1.5} style={{ color: 'var(--text3)' }} />
          </div>
        )}

        {/* Overlay on hover */}
        <div
          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          style={{ background: 'rgba(0,0,0,0.5)' }}
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'var(--blue)' }}
          >
            <Play size={18} fill="white" color="white" />
          </div>
        </div>

        {/* Favorite */}
        <button
          className="hover-reveal absolute top-1.5 right-1.5 w-7 h-7 sm:w-6 sm:h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={toggleFav}
          aria-label={isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        >
          <Heart
            size={11}
            strokeWidth={2}
            style={{
              color: isFav ? 'var(--red)' : 'white',
              fill:  isFav ? 'var(--red)' : 'transparent',
            }}
          />
        </button>

        {/* Delete (admin only) */}
        {isAdmin && (
          <button
            className="hover-reveal absolute top-1.5 left-1.5 w-7 h-7 sm:w-6 sm:h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={handleDelete}
            disabled={deleting}
            aria-label="Supprimer de la bibliothèque"
          >
            <Trash2 size={11} strokeWidth={2} style={{ color: 'var(--red)' }} />
          </button>
        )}

        {/* Rating */}
        {item.rating && (
          <div
            className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold"
            style={{ background: 'rgba(0,0,0,0.7)', color: 'var(--yellow)' }}
          >
            <Star size={8} fill="var(--yellow)" color="var(--yellow)" />
            {Number(item.rating).toFixed(1)}
          </div>
        )}

        {/* Type badge */}
        {showType && (
          <div
            className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
            style={{
              background: `color-mix(in srgb, ${typeColors[item.type]} 20%, rgba(0,0,0,0.6))`,
              color: typeColors[item.type],
            }}
          >
            {item.type}
          </div>
        )}

        {/* Progress bar */}
        {pct > 0 && pct < 100 && (
          <div
            className="absolute bottom-0 left-0 right-0 h-[3px]"
            style={{ background: 'rgba(255,255,255,0.2)' }}
          >
            <div
              className="h-full"
              style={{ width: `${pct}%`, background: 'var(--blue)' }}
            />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="text-[11.5px] font-semibold truncate" style={{ color: 'var(--text)' }}>
        {item.title}
      </div>
      {item.year && (
        <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text3)' }}>
          {item.year}
        </div>
      )}
    </div>
  )
}
