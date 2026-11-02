import { useState } from 'react'
import { Heart, Play, Star, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { MediaItem } from '@/types'
import { mediaService } from '@/services/mediaService'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/services/api'
import toast from 'react-hot-toast'
import { ROW_CARD_WIDTH } from './layout'
import Artwork from './Artwork'
import { useConfirm } from '@/components/ui/useConfirm'

interface MediaCardProps {
  item:       MediaItem
  showType?:  boolean
  progress?:  number
  duration?:  number
  /** Small label under the title (e.g. "S1 · É3") */
  subtitle?:  string
  /** row: fixed responsive width for horizontal rows · grid: fills its grid cell */
  variant?:   'row' | 'grid'
}

const TYPE_COLORS: Record<string, string> = {
  film:    'var(--red)',
  serie:   'var(--blue)',
  anime:   'var(--teal)',
  manga:   'var(--purple)',
  webtoon: 'var(--orange)',
}

export default function MediaCard({ item, showType, progress, duration, subtitle, variant = 'row' }: MediaCardProps) {
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const isAdmin   = useAuthStore((s) => s.user?.role === 'admin')
  const confirm   = useConfirm()
  const [isFav,     setIsFav]     = useState(false)
  const [deleting,  setDeleting]  = useState(false)

  const pct = progress && duration ? Math.round((progress / duration) * 100) : 0

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    const ok = await confirm({
      title: `Retirer « ${item.title} » de la bibliothèque ?`,
      message: 'Le titre disparaît de Nexus. Les fichiers sur le disque ne sont pas supprimés (un nouveau scan le fera réapparaître).',
      confirmLabel: 'Retirer',
      danger: true,
    })
    if (!ok) return
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
      toast.success(result ? 'Ajouté à ma liste' : 'Retiré de ma liste')
    } catch { toast.error('Erreur') }
  }

  return (
    <div
      className={`${variant === 'grid' ? 'w-full min-w-0' : `${ROW_CARD_WIDTH} flex-shrink-0 snap-start`} cursor-pointer group`}
      onClick={() => navigate(`/media/${item.id}`)}
      role="link"
      aria-label={item.title}
    >
      {/* Poster (whole image, never cropped; placeholder when missing) */}
      <Artwork
        src={item.posterPath}
        alt={item.title}
        type={item.type}
        title={item.title}
        subtitle={item.year}
        className="w-full rounded-lg mb-1.5 transition-transform duration-300 lg:group-hover:scale-[1.04] lg:group-hover:shadow-xl"
      >
        {/* Hover overlay */}
        <div className="absolute inset-0 hidden lg:flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          style={{ background: 'rgba(0,0,0,0.35)' }}>
          <div className="w-11 h-11 rounded-full flex items-center justify-center bg-white/90">
            <Play size={18} fill="black" color="black" style={{ marginLeft: 2 }} />
          </div>
        </div>

        {/* My list */}
        <button
          className="hover-reveal absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={toggleFav}
          aria-label={isFav ? 'Retirer de ma liste' : 'Ajouter à ma liste'}
        >
          <Heart size={12} strokeWidth={2}
            style={{ color: isFav ? 'var(--red)' : 'white', fill: isFav ? 'var(--red)' : 'transparent' }} />
        </button>

        {/* Delete (admin only, desktop hover) */}
        {isAdmin && (
          <button
            className="absolute top-1.5 left-1.5 w-7 h-7 rounded-full hidden lg:flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={handleDelete}
            disabled={deleting}
            aria-label="Supprimer de la bibliothèque"
          >
            <Trash2 size={12} strokeWidth={2} style={{ color: 'var(--red)' }} />
          </button>
        )}

        {/* Rating */}
        {item.rating != null && Number(item.rating) > 0 && (
          <div className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold"
            style={{ background: 'rgba(0,0,0,0.7)', color: 'var(--yellow)' }}>
            <Star size={8} fill="var(--yellow)" color="var(--yellow)" />
            {Number(item.rating).toFixed(1)}
          </div>
        )}

        {showType && (
          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
            style={{ background: `color-mix(in srgb, ${TYPE_COLORS[item.type]} 20%, rgba(0,0,0,0.6))`, color: TYPE_COLORS[item.type] }}>
            {item.type}
          </div>
        )}

        {/* Progress bar (continue watching) */}
        {pct > 0 && pct < 100 && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px]" style={{ background: 'rgba(255,255,255,0.25)' }}>
            <div className="h-full" style={{ width: `${pct}%`, background: 'var(--red)' }} />
          </div>
        )}
      </Artwork>

      {/* Title */}
      <div className="text-[11.5px] sm:text-[12.5px] font-semibold truncate" style={{ color: 'var(--text)' }}>
        {item.title}
      </div>
      <div className="text-[10px] sm:text-[10.5px] font-mono truncate" style={{ color: 'var(--text3)' }}>
        {subtitle ?? item.year ?? ' '}
      </div>
    </div>
  )
}
