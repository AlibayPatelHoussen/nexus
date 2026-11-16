import { api } from './api'
import { withStreamToken } from './streamToken'

/** A file sent from one of the account's devices (Aperçu › Transferts) */
export interface Transfer {
  id:        string
  name:      string
  size:      number
  mime:      string | null
  /** « iPhone · Safari » */
  device:    string | null
  createdAt: string
  expiresAt: string
}

/** This page: the live events it caused itself are not announced to it again */
export const PAGE_ID = (() => {
  try { return crypto.randomUUID() } catch { /* plain http on the local network */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
})()
const fromThisPage = { 'X-Nexus-Client': PAGE_ID }

export const transfersService = {
  async list(): Promise<Transfer[]> {
    const { data } = await api.get<{ success: boolean; data: Transfer[] }>('/transfers')
    return data.data
  },

  async send(files: File[], onProgress: (loaded: number, total: number) => void, signal: AbortSignal): Promise<Transfer[]> {
    const form = new FormData()
    files.forEach((f) => form.append('files', f, f.name))
    const { data } = await api.post<{ success: boolean; data: Transfer[] }>('/transfers', form, {
      headers: { 'Content-Type': 'multipart/form-data', ...fromThisPage },
      onUploadProgress: (e) => onProgress(e.loaded, e.total ?? 0),
      signal,
    })
    return data.data
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/transfers/${encodeURIComponent(id)}`, { headers: fromThisPage })
  },

  async clear(): Promise<void> {
    await api.delete('/transfers', { headers: fromThisPage })
  },

  /** The file (a link: a stream token); `inline` for the images shown in the list */
  fileUrl(id: string, token: string, inline = false): string {
    return withStreamToken(`/api/transfers/${encodeURIComponent(id)}/file${inline ? '?inline=1' : ''}`, token)
  },
}

/** Shown in the list (the server serves them inline); the rest is downloaded only */
export const isPreviewable = (t: Transfer) => /^image\/(jpeg|png|gif|webp|avif)$/.test(t.mime ?? '')
