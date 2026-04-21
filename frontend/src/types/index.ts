// ── Auth ─────────────────────────────────────────────
export interface User {
  id:       string
  username: string
  email:    string
  role:     'admin' | 'user'
  theme:    'dark' | 'light'
}

export interface AuthState {
  user:         User | null
  accessToken:  string | null
  isAuth:       boolean
}

// ── System ───────────────────────────────────────────
export interface SystemStats {
  cpu: {
    usage: number
    cores: number
    model: string
    speed: number
  }
  memory: {
    total:       number
    used:        number
    free:        number
    usedPercent: number
  }
  disk: {
    total:       number
    used:        number
    free:        number
    usedPercent: number
  }
  temperature: number | null
  uptime:      number
  network: {
    status:    'online' | 'offline'
    ip:        string
    interface: string
    rx:        number
    tx:        number
  }
  os: {
    platform: string
    distro:   string
    release:  string
    hostname: string
    arch:     string
  }
}

// ── Files ────────────────────────────────────────────
export interface FileEntry {
  name:        string
  path:        string
  type:        'file' | 'directory'
  size:        number | null
  mimeType:    string | null
  extension:   string | null
  modified:    string
  created:     string
  permissions: string
}

// ── Services ─────────────────────────────────────────
export type ServiceStatus = 'active' | 'inactive' | 'failed' | 'unknown'

export interface ServiceInfo {
  name:        string
  displayName: string
  description: string
  status:      ServiceStatus
  url?:        string
  icon:        string
  color:       string
}

// ── Media ────────────────────────────────────────────
export type MediaType = 'film' | 'serie' | 'anime' | 'manga' | 'webtoon'

export interface MediaItem {
  id:            string
  type:          MediaType
  title:         string
  originalTitle: string | null
  filePath:      string
  tmdbId:        number | null
  anilistId:     number | null
  mangadexId:    string | null
  overview:      string | null
  posterPath:    string | null
  backdropPath:  string | null
  genres:        string[]
  year:          number | null
  rating:        number | null
  voteCount:     number | null
  status:        string | null
  language:      string | null
  fileSize:      number | null
  duration:      number | null
  createdAt:     string
  updatedAt:     string
}

export interface Episode {
  id:            string
  mediaItemId:   string
  season:        number | null
  episodeNumber: number
  title:         string | null
  overview:      string | null
  filePath:      string
  fileSize:      number | null
  duration:      number | null
  thumbnailPath: string | null
  airDate:       string | null
}

export interface Chapter {
  id:            string
  mediaItemId:   string
  chapterNumber: number
  title:         string | null
  folderPath:    string
  pageCount:     number | null
}

// ── Watch History ────────────────────────────────────
export interface WatchProgress {
  mediaItemId: string
  episodeId:   string | null
  progress:    number
  duration:    number | null
  completed:   boolean
  watchedAt:   string
}

// ── API Response ─────────────────────────────────────
export interface ApiResponse<T> {
  success: boolean
  data:    T
  error?:  string
}

// ── Theme ────────────────────────────────────────────
export type Theme = 'dark' | 'light'
