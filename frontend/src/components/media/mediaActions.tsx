import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Heart, ImageIcon, Info, Play, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { MediaItem } from '@/types'
import { mediaService } from '@/services/mediaService'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/services/api'
import { useConfirm } from '@/components/ui/useConfirm'
import type { MenuItem } from '@/components/ui/ContextMenu'

export const isReading = (t: string) => t === 'manga' || t === 'webtoon'
export const rating = (r: number | null | undefined) =>
  r != null && Number(r) > 0 ? Number(r).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : null

/** Menu of a title (right click on desktop, long press on touch). */
export function useMediaActions() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const confirm = useConfirm()

  return (item: MediaItem): MenuItem[] => [
    { label: isReading(item.type) ? 'Lire' : 'Lecture', icon: <Play />, onSelect: () => navigate(isReading(item.type) ? `/media/${item.id}` : `/player/${item.id}`) },
    { label: 'Plus d’infos', icon: <Info />, onSelect: () => navigate(`/media/${item.id}`) },
    {
      label: 'Ajouter à ma liste', icon: <Heart />,
      onSelect: async () => {
        try {
          const fav = await mediaService.toggleFavorite(item.id)
          toast.success(fav ? 'Ajouté à ma liste' : 'Retiré de ma liste')
        } catch { toast.error('Impossible de modifier ta liste') }
      },
    },
    ...(isAdmin ? [
      { separator: true } as const,
      ...(item.tmdbId && ['film', 'serie', 'anime'].includes(item.type)
        ? [{ label: 'Image et logo…', icon: <ImageIcon />, onSelect: () => navigate(`/media/${item.id}?artwork=1`) }] : []),
      {
        label: 'Retirer de la bibliothèque…', icon: <Trash2 />, destructive: true,
        onSelect: async () => {
          const ok = await confirm({
            title: `Retirer « ${item.title} » de la bibliothèque ?`,
            message: 'Le titre disparaît de Nexus. Les fichiers sur le disque ne sont pas supprimés (une nouvelle analyse le fera réapparaître).',
            confirmLabel: 'Retirer',
            danger: true,
          })
          if (!ok) return
          try {
            await api.delete(`/media/${item.id}`)
            toast.success(`« ${item.title} » retiré`)
            qc.invalidateQueries({ queryKey: ['media'] })
          } catch { toast.error('Le titre n’a pas pu être retiré') }
        },
      },
    ] : []),
  ]
}

