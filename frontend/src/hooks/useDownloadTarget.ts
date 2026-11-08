import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { Follow, SearchResult } from '@/services/downloadsService'

/** The title on the download site (movix / anime-sama) that a library title comes from. */
export interface DownloadTarget { sourceId: string; title: string; poster_url: string | null; lang: string; season?: string; follow: Follow | null }

export type DownloadableKind = 'anime' | 'serie' | 'manga'

/** Library type → download kind (only series, animes and mangas can get more episodes / chapters). */
export function downloadKind(type: string | undefined): DownloadableKind | null {
  if (type === 'serie' || type === 'anime' || type === 'manga') return type
  return type === 'webtoon' ? 'manga' : null
}

/**
 * Found by the server from the downloads that made the title's files, else by its name on
 * the site (can take a few seconds). Shared by « Télécharger » and the automatic downloads.
 */
export function useDownloadTarget(mediaId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['follow-target', mediaId],
    queryFn: async () => (await api.get<{ data: DownloadTarget }>(`/downloads/follows/media/${mediaId}`)).data.data,
    enabled: enabled && !!mediaId,
    retry: false, staleTime: 5 * 60_000,
  })
}

/** What the download sheet needs to list the episodes / chapters of that title. */
export function targetResult(t: DownloadTarget, kind: DownloadableKind): SearchResult {
  return { id: t.sourceId, source: t.sourceId.startsWith('movix:') ? 'movix' : 'anisama', kind, title: t.title, poster_url: t.poster_url }
}
