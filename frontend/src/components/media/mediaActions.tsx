import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Info, Play, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { MediaItem } from '@/types'
import { useFavorites } from '@/hooks/useFavorites'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/services/api'
import { useConfirm } from '@/components/ui/useConfirm'
import { filesService } from '@/services/filesService'
import { serverError, showError } from '@/utils/errorToast'
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
  const favorites = useFavorites()

  return (item: MediaItem): MenuItem[] => [
    { label: isReading(item.type) ? 'Lire' : 'Lecture', icon: <Play />, onSelect: () => navigate(isReading(item.type) ? `/media/${item.id}` : `/player/${item.id}`) },
    { label: 'Plus d’infos', icon: <Info />, onSelect: () => navigate(`/media/${item.id}`) },
    favorites.isFav(item.id)
      ? { label: 'Retirer de ma liste', icon: <Check />, onSelect: () => favorites.toggle(item) }
      : { label: 'Ajouter à ma liste', icon: <Plus />, onSelect: () => favorites.toggle(item) },
    ...(isAdmin ? [
      { separator: true } as const,
      {
        label: 'Supprimer de la bibliothèque…', icon: <Trash2 />, destructive: true,
        onSelect: async () => {
          const ok = await confirm({
            title: `Supprimer « ${item.title} » ?`,
            message: 'Le titre est supprimé partout : ses fichiers sur le disque, la bibliothèque (progression, Reprendre, ma liste), ' +
                     'ses téléchargements et son suivi des nouveaux épisodes. C’est définitif.',
            confirmLabel: 'Supprimer',
            danger: true,
          })
          if (!ok) return
          const done = () => {
            toast.success(`« ${item.title} » supprimé`)
            for (const key of ['media', 'downloads', 'follows']) void qc.invalidateQueries({ queryKey: [key] })
          }
          try {
            await api.delete(`/media/${item.id}`)
            done()
          } catch (err) {
            const data = (err as { response?: { data?: { code?: string; details?: { paths?: string[] } } } })?.response?.data
            const paths = data?.details?.paths ?? []
            if (data?.code !== 'NEEDS_PASSWORD' || !paths.length) { showError('Suppression impossible', serverError(err)); return }
            // Files owned by root…: forced with the server's sudo password, then deleted everywhere
            const forced = await confirm({
              title: `Forcer la suppression de « ${item.title} » ?`,
              message: 'Nexus n’a pas les droits pour supprimer ces fichiers (ils appartiennent à un autre utilisateur, souvent root). ' +
                       'Entre le mot de passe du serveur (celui que tu utilises pour sudo) pour les supprimer quand même. Il n’est pas enregistré.',
              details: paths,
              confirmLabel: 'Supprimer',
              danger: true,
              password: {
                label: 'Mot de passe du serveur (sudo)',
                submit: async (password) => {
                  try {
                    const { failed } = await filesService.deleteElevated(paths, password)
                    if (failed.length) return failed[0].error
                    // 404: removing the files already removed the title (and its downloads, follow)
                    await api.delete(`/media/${item.id}`, { validateStatus: (s) => s === 200 || s === 404 })
                    return null
                  } catch (e) { return serverError(e) }
                },
              },
            })
            if (forced) done()
            else showError('Suppression impossible', serverError(err))
          }
        },
      },
    ] : []),
  ]
}

