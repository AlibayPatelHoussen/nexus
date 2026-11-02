import { api } from './api'
import { useAuthStore } from '@/stores/authStore'

export type PlayMode = 'direct' | 'remux' | 'transcode'

export interface PlayInfo {
  mode:     PlayMode
  duration: number | null
  video:    string | null
  audio:    string | null
  reason:   string
  ffmpeg:   boolean
}

export interface TranscodeSession {
  id:       string
  mode:     Exclude<PlayMode, 'direct'>
  start:    number
  duration: number | null
  playlist: string
}

/** WebM is played directly only by browsers that really support it. */
function webmFlag(): '1' | '0' {
  try {
    return document.createElement('video').canPlayType('video/webm; codecs="vp9, opus"') === 'probably' ? '1' : '0'
  } catch { return '0' }
}

/** Ask the server whether this file can be streamed as-is or must be converted. */
export async function getPlayInfo(path: string): Promise<PlayInfo> {
  const { data } = await api.get<{ success: boolean; data: PlayInfo }>('/files/play-info', { params: { path, webm: webmFlag() } })
  return data.data
}

/** Start an on-the-fly conversion (HLS) at `start` seconds. */
export async function startTranscode(path: string, start: number): Promise<TranscodeSession> {
  const { data } = await api.post<{ success: boolean; data: TranscodeSession }>(
    '/files/transcode', {}, { params: { path, start: Math.max(0, Math.floor(start)), webm: webmFlag() } },
  )
  return data.data
}

/** Stop a conversion now (player closed, seek elsewhere). Survives page unload. */
export function stopTranscode(id: string): void {
  const token = useAuthStore.getState().accessToken
  fetch(`/api/files/transcode/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    keepalive: true,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).catch(() => {})
}
