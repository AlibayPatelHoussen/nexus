import { api } from './api'

/** Réglages › Bibliothèque › Noms pour Jellyfin (admins) */
export interface RenameTitle {
  mediaId: string
  type: 'film' | 'serie' | 'anime'
  title: string
  /** File or folder name now / once renamed */
  from: string
  to: string
  files: number
  /** Joins the title that already has this folder */
  merge: boolean
  examples: { from: string; to: string }[]
  skipped: { name: string; reason: string }[]
}
export interface RenamePlan { titles: RenameTitle[]; files: number }
export interface RenameResult {
  batch: string
  renamed: { mediaId: string; title: string; files: number }[]
  skipped: { title: string; path: string; reason: string }[]
  errors: { title: string; error: string }[]
}
export interface RenameBatch { batch: string; at: string; titles: number; files: number; auto: boolean; undone: boolean }

export const renameService = {
  async plan(): Promise<RenamePlan> {
    return (await api.get<{ data: RenamePlan }>('/library/rename/plan')).data.data
  },
  async apply(mediaIds?: string[]): Promise<RenameResult> {
    return (await api.post<{ data: RenameResult }>('/library/rename/apply', { mediaIds })).data.data
  },
  async history(): Promise<RenameBatch[]> {
    return (await api.get<{ data: RenameBatch[] }>('/library/rename/history')).data.data
  },
  async undo(batch: string): Promise<{ restored: number; failed: number }> {
    return (await api.post<{ data: { restored: number; failed: number } }>(`/library/rename/undo/${batch}`)).data.data
  },
  async settings(): Promise<{ auto: boolean }> {
    return (await api.get<{ data: { auto: boolean } }>('/library/rename/settings')).data.data
  },
  async setAuto(auto: boolean): Promise<{ auto: boolean }> {
    return (await api.put<{ data: { auto: boolean } }>('/library/rename/settings', { auto })).data.data
  },
}
