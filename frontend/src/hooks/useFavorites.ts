import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { mediaService } from '@/services/mediaService'
import type { MediaItem } from '@/types'

export const FAVORITES_KEY = ['media', 'favorites'] as const

/**
 * « Ma liste »: one list shared by every button (billboard, title page, menus, shelves),
 * so they all show the same state. Adding / removing updates them at once (optimistic),
 * then the server's answer.
 */
export function useFavorites() {
  const qc = useQueryClient()
  const { data: items = [], isLoading } = useQuery({ queryKey: FAVORITES_KEY, queryFn: mediaService.getFavorites, staleTime: 30_000 })

  const mut = useMutation({
    mutationFn: async ({ item, add }: { item: MediaItem; add: boolean }) => {
      const on = await mediaService.toggleFavorite(item.id)
      // The server toggles: if another device changed it meanwhile, toggle back to what was asked
      return on === add ? on : mediaService.toggleFavorite(item.id)
    },
    onMutate: async ({ item, add }) => {
      await qc.cancelQueries({ queryKey: FAVORITES_KEY })
      const before = qc.getQueryData<MediaItem[]>(FAVORITES_KEY)
      qc.setQueryData<MediaItem[]>(FAVORITES_KEY, (list = []) =>
        add ? [item, ...list.filter((m) => m.id !== item.id)] : list.filter((m) => m.id !== item.id))
      return { before }
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(FAVORITES_KEY, ctx?.before)
      toast.error('Impossible de modifier ta liste')
    },
    onSuccess: (on) => toast.success(on ? 'Ajouté à ma liste' : 'Retiré de ma liste'),
    onSettled: () => { void qc.invalidateQueries({ queryKey: FAVORITES_KEY }) },
  })

  const isFav = useCallback((id: string) => items.some((m) => m.id === id), [items])
  const toggle = useCallback((item: MediaItem) => mut.mutate({ item, add: !items.some((m) => m.id === item.id) }), [mut, items])

  return { items, isLoading, isFav, toggle, busy: mut.isPending }
}
