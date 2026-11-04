import { api } from './api'

export type DownloadKind = 'anime' | 'manga' | 'film' | 'serie' | 'youtube'
export type DownloadSource = 'anisama' | 'movix' | 'films' | 'youtube'
export type DownloadStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'

/** One search result card (fields sent by the scripts) */
export interface SearchResult {
  id:            string
  source:        DownloadSource
  kind:          DownloadKind
  title:         string
  poster_url?:   string | null
  thumbnail_url?: string | null
  year?:         number | null
  description?:  string | null
  duration?:     number | null
  channel?:      string | null
  langs?:        string[]
  seasons?:      { id: string | number; label: string; langs?: string[]; episodes_count?: number }[]
}

export interface DetailEpisode { n: number; label: string; downloaded: boolean | string[]; available?: boolean; air_date?: string | null; langs?: string[] | null }
export interface DetailChapter { n: number; pages: number; downloaded: boolean }

export interface Details {
  id:           string
  kind:         DownloadKind
  title:        string
  poster_url?:  string | null
  description?: string | null
  /** anime: one entry per season + language; serie: one per season (langs on top) */
  seasons?:     { id: string | number; lang?: string; langs?: string[]; label: string; episodes: DetailEpisode[] }[]
  /** manga: one entry per language; film: availability per language */
  langs?:       ({ lang: string; chapters?: DetailChapter[]; downloaded?: boolean; available?: boolean } | string)[]
}

export interface DownloadProgress {
  item?: string; index?: number; total?: number
  percent?: number | null; downloaded_mb?: number; total_mb?: number | null; speed?: string; eta?: string
  chapter?: number; chapters_total?: number; page?: number; pages_total?: number
  items_done?: number; items_skipped?: number; files?: string[]; errors?: string[]
  result?: { ok?: number; failed?: number; skipped?: number }
}

export interface Download {
  id:            string
  kind:          DownloadKind
  source_script: DownloadSource
  source_id:     string
  title:         string
  poster_url:    string | null
  options:       { lang?: string; season?: string }
  selection:     { episodes?: number[]; chapters?: number[] }
  status:        DownloadStatus
  progress:      DownloadProgress
  dest_path:     string | null
  error:         string | null
  created_at:    string
  started_at:    string | null
  finished_at:   string | null
}

export interface NewDownload {
  id: string; title: string; poster_url?: string | null
  lang?: string; season?: string | number; episodes?: number[]; chapters?: number[]; force?: boolean
}

/** The image proxy URL keeps the original address in ?u= (needed to queue a job) */
export function originalImage(url: string | null | undefined): string | null {
  if (!url) return null
  if (!url.startsWith('/api/images/remote')) return url
  try { return new URL(url, window.location.origin).searchParams.get('u') } catch { return null }
}

/** Where a result comes from: the site and the script that downloads it */
export const SOURCE_INFO: Record<DownloadSource, { site: string; script: string }> = {
  anisama: { site: 'anime-sama', script: 'anisama.py' },
  movix:   { site: 'movix', script: 'movix.py' },
  films:   { site: 'wadrox', script: 'films.py' },
  youtube: { site: 'YouTube', script: 'youtube.py' },
}

export interface Follow {
  id: string; source_id: string; kind: DownloadKind; title: string
  options: { lang?: string; season?: string }; enabled: boolean
  last_checked_at: string | null; last_error: string | null
}

export interface CatalogueInfo { count: number; updatedAt: string | null; refreshing: boolean; last: { at: string; added: number; error: string | null } | null }

export const downloadsService = {
  catalogue: async () => (await api.get<{ data: CatalogueInfo }>('/downloads/catalogue')).data.data,
  refreshCatalogue: async () => (await api.post<{ data: CatalogueInfo }>('/downloads/catalogue/refresh')).data.data,
  follow: async (id: string) => (await api.get<{ data: Follow | null }>('/downloads/follows', { params: { id } })).data.data,
  setFollow: async (body: { id: string; title?: string; poster_url?: string | null; lang?: string; season?: string | number; enabled: boolean }) =>
    (await api.put<{ data: Follow | null }>('/downloads/follows', body)).data.data,
  search: async (query: string) =>
    (await api.post<{ data: { searchId: string; sources: DownloadSource[] } }>('/downloads/search', { query })).data.data,
  details: async (id: string) => (await api.get<{ data: Details }>('/downloads/details', { params: { id } })).data.data,
  list: async () => (await api.get<{ data: Download[] }>('/downloads')).data.data,
  create: async (body: NewDownload) => (await api.post<{ data: Download }>('/downloads', body)).data.data,
  act: async (id: string, action: 'pause' | 'resume' | 'cancel' | 'retry') =>
    (await api.post<{ data: Download }>(`/downloads/${id}/${action}`)).data.data,
  remove: async (id: string) => { await api.delete(`/downloads/${id}`) },
  open: async (id: string) =>
    (await api.get<{ data: { mediaId: string; episodeId?: string; chapterId?: string; reader: 'player' | 'reader' } }>(`/downloads/${id}/open`)).data.data,
}
