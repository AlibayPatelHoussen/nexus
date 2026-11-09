import { api } from './api'

export interface IptvStream {
  quality: string | null; labels: string[]; title: string | null
  /** 'page': the live of a web page (YouTube, Twitch, Dailymotion), found by the server when it is played */
  kind: 'hls' | 'page'
  source: 'iptv-org' | 'free-tv'
  /** The address of that web page (never the address of a stream) */
  page: string | null
}
export interface IptvChannel {
  id: string
  name: string
  country: string | null
  categories: string[]
  languages: string[]
  logo: string | null
  website: string | null
  network: string | null
  labels: string[]
  status: 'unknown' | 'online' | 'offline'
  statusReason: string | null
  checkedAt: string | null
  streams: IptvStream[]
  /** In the hand-picked Free-TV list */
  curated: boolean
  /** The stream the last check found working (index in `streams`) */
  bestStream: number | null
  favorite: boolean
  guide?: { start: string; end: string; title: string; description: string | null }[]
}
export interface IptvFacets {
  countries: { code: string; name: string; flag?: string | null; count: number }[]
  categories: { id: string; name: string; count: number }[]
  languages: { code: string; name: string; count: number }[]
}
export interface IptvRefresh {
  running: boolean; at: string | null; ok: boolean | null; message: string | null
  stats: Record<string, number> | null; notes: string[]; source: string | null
  /** The lists the catalogue was built from: 'iptv-org', 'free-tv' */
  sources: string[]
}
export interface IptvSummary extends IptvFacets {
  total: number; online: number; offline: number; checked: number
  favorites: IptvChannel[]; recent: IptvChannel[]; popular: IptvChannel[]; refresh: IptvRefresh
  /** The owner's priority countries, in their order; `count: 0` when no source has a channel for it */
  priority: { code: string; name: string | null; flag: string | null; count: number; items: IptvChannel[] }[]
}
export interface IptvSettings { autoRefresh: boolean; hideOffline: boolean; epgUrl: string | null; priorityCountries: string[] }
/** 'top': priority countries, verified channels and the Free-TV selection first */
export type ChannelSort = 'top' | 'name' | '-name'
export interface ChannelQuery {
  q?: string; country?: string; category?: string; language?: string
  status?: 'online' | 'all'; sort?: ChannelSort; page?: number; limit?: number
}

const data = <T,>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data)
const enc = encodeURIComponent

export const iptvService = {
  summary: () => data<IptvSummary>(api.get('/iptv/summary')),
  facets: () => data<IptvFacets>(api.get('/iptv/facets')),
  channels: (q: ChannelQuery) => data<{ items: IptvChannel[]; total: number; page: number; limit: number }>(api.get('/iptv/channels', { params: q })),
  channel: (id: string) => data<IptvChannel>(api.get(`/iptv/channels/${enc(id)}`)),
  check: (id: string) => data<IptvChannel>(api.post(`/iptv/channels/${enc(id)}/check`)),
  favorites: () => data<IptvChannel[]>(api.get('/iptv/favorites')),
  addFavorite: (id: string) => api.put(`/iptv/favorites/${enc(id)}`),
  removeFavorite: (id: string) => api.delete(`/iptv/favorites/${enc(id)}`),
  reorderFavorites: (ids: string[]) => data<IptvChannel[]>(api.put('/iptv/favorites/order', { ids })),
  history: () => data<IptvChannel[]>(api.get('/iptv/history')),
  watched: (id: string) => api.post(`/iptv/history/${enc(id)}`),
  settings: () => data<{ settings: IptvSettings; refresh: IptvRefresh }>(api.get('/iptv/settings')),
  saveSettings: (s: Partial<Omit<IptvSettings, 'priorityCountries'>> & { priorityCountries?: string[] | string }) => data<IptvSettings>(api.put('/iptv/settings', s)),
  refresh: () => data<IptvRefresh>(api.post('/iptv/refresh')),
  /** Playlist relayed by the server (stream token in the URL: media elements send no header) */
  playUrl: (id: string, stream: number, token: string) => `/api/iptv/play/${enc(id)}/${stream}/index.m3u8?token=${enc(token)}`,
}
