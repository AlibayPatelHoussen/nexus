import { api } from './api'
import { getStreamToken, withStreamToken } from './streamToken'
import type { FileEntry } from '@/types'

export interface DeleteResult {
  deleted: string[]
  failed:  { path: string; error: string }[]
}

export const filesService = {
  async list(path: string): Promise<FileEntry[]> {
    const { data } = await api.get<{ success: boolean; data: FileEntry[] }>(
      `/files?path=${encodeURIComponent(path)}`,
    )
    return data.data
  },

  async readFile(path: string): Promise<string> {
    const { data } = await api.get<{ success: boolean; data: string }>(
      `/files/read?path=${encodeURIComponent(path)}`,
    )
    return data.data
  },

  async writeFile(path: string, content: string): Promise<void> {
    await api.put('/files/write', { path, content })
  },

  async createDir(path: string): Promise<void> {
    await api.post('/files/mkdir', { path })
  },

  async createFile(path: string, content = ''): Promise<void> {
    await api.post('/files/touch', { path, content })
  },

  async rename(path: string, newName: string): Promise<void> {
    await api.patch('/files/rename', { path, newName })
  },

  async move(src: string, dest: string): Promise<void> {
    await api.patch('/files/move', { src, dest })
  },

  async delete(path: string): Promise<void> {
    await api.delete(`/files?path=${encodeURIComponent(path)}`)
  },

  /** Delete several entries; the server reports each success / failure. */
  async deleteMany(paths: string[]): Promise<DeleteResult> {
    const { data } = await api.post<{ success: boolean; data: DeleteResult }>(
      '/files/delete', { paths }, { validateStatus: (s) => s === 200 || s === 422 },
    )
    return data.data
  },

  /** Build a media URL from an already-fetched stream token (see getStreamToken). */
  buildStreamUrl(path: string, streamToken: string): string {
    return withStreamToken(`/api/files/stream?path=${encodeURIComponent(path)}`, streamToken)
  },

  async getStreamUrl(path: string): Promise<string> {
    return this.buildStreamUrl(path, await getStreamToken())
  },

  async getDownloadUrl(path: string): Promise<string> {
    return withStreamToken(`/api/files/download?path=${encodeURIComponent(path)}`, await getStreamToken())
  },

  async upload(destPath: string, files: File[], onProgress?: (pct: number) => void): Promise<void> {
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    await api.post(`/files/upload?path=${encodeURIComponent(destPath)}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
      },
    })
  },
}
