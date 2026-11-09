import { api } from './api'

/** A TV found by the server on its network (DLNA / UPnP renderer or Roku). */
export interface CastDevice { id: string; name: string; kind: 'dlna' | 'roku'; model: string | null }
export interface CastStatus { state: 'playing' | 'paused' | 'stopped' | 'loading' | 'idle'; position: number | null; duration: number | null }

export const castService = {
  async devices(refresh = false): Promise<CastDevice[]> {
    const { data } = await api.get<{ data: CastDevice[] }>('/cast/devices', { params: refresh ? { refresh: 1 } : {} })
    return data.data
  },
  async play(deviceId: string, path: string, title: string, startAt: number): Promise<void> {
    await api.post('/cast/play', { deviceId, path, title, startAt })
  },
  async status(deviceId: string): Promise<CastStatus> {
    const { data } = await api.get<{ data: CastStatus }>('/cast/status', { params: { deviceId } })
    return data.data
  },
  async control(deviceId: string, action: 'play' | 'pause' | 'stop' | 'seek', position?: number): Promise<void> {
    await api.post('/cast/control', { deviceId, action, position })
  },
}
