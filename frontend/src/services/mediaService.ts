import { api } from './api'
import type { MediaItem, Episode, Chapter } from '@/types'

export interface WatchHistoryItem extends Pick<MediaItem, 'id' | 'type' | 'title' | 'posterPath' | 'year'> {
  progress:     number
  duration:     number | null
  episodeId:    string | null
  updatedAt:    string
  season?:      number | null
  episodeNumber?: number
  episodeTitle?: string | null
}

export interface MediaFilters {
  type?:    string
  genre?:   string
  year?:    number
  search?:  string
  page?:    number
  limit?:   number
  sortBy?:  string
  sortDir?: 'asc' | 'desc'
}

export interface MediaListResult {
  items:      MediaItem[]
  total:      number
  page:       number
  limit:      number
  totalPages: number
}

export const mediaService = {
  async getAll(filters: MediaFilters = {}): Promise<MediaListResult> {
    const { data } = await api.get<{ success: boolean; data: MediaListResult }>('/media', { params: filters })
    return data.data
  },

  async getById(id: string): Promise<MediaItem & { episodes?: Episode[]; chapters?: Chapter[] }> {
    const { data } = await api.get<{ success: boolean; data: MediaItem & { episodes?: Episode[]; chapters?: Chapter[] } }>(`/media/${id}`)
    return data.data
  },

  async getRecent(type?: string, limit = 12): Promise<MediaItem[]> {
    const { data } = await api.get<{ success: boolean; data: MediaItem[] }>('/media/recent', {
      params: { type, limit },
    })
    return data.data
  },

  async getContinueWatching(): Promise<WatchHistoryItem[]> {
    const { data } = await api.get<{ success: boolean; data: WatchHistoryItem[] }>('/media/continue')
    return data.data
  },

  async getFavorites(): Promise<MediaItem[]> {
    const { data } = await api.get<{ success: boolean; data: MediaItem[] }>('/media/favorites')
    return data.data
  },

  async toggleFavorite(id: string): Promise<boolean> {
    const { data } = await api.post<{ success: boolean; data: { isFavorite: boolean } }>(`/media/${id}/favorite`)
    return data.data.isFavorite
  },

  async getGenres(type?: string): Promise<string[]> {
    const { data } = await api.get<{ success: boolean; data: string[] }>('/media/genres', { params: { type } })
    return data.data
  },

  async saveProgress(id: string, progress: number, duration: number, episodeId?: string): Promise<void> {
    await api.post(`/media/${id}/progress`, { progress, duration, episodeId })
  },

  async getProgress(id: string, episodeId?: string): Promise<{ progress: number; duration: number; completed: boolean } | null> {
    const { data } = await api.get<{ success: boolean; data: { progress: number; duration: number; completed: boolean } | null }>(`/media/${id}/progress`, {
      params: { episodeId },
    })
    return data.data
  },

  async scan(type?: string): Promise<void> {
    await api.post(type ? `/media/scan/${type}` : '/media/scan')
  },
}
