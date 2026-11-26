import { api } from './api'

/** What this account read in a chapter (server: read_history) */
export interface ChapterReading {
  chapterId:   string
  /** 0-based page reached */
  currentPage: number
  completed:   boolean
  updatedAt:   string
}

export const readingService = {
  /** The chapters of a title this account opened or marked, the most recent first */
  async of(mediaId: string): Promise<ChapterReading[]> {
    const { data } = await api.get<{ data: ChapterReading[] }>(`/media/${mediaId}/reading`)
    return data.data
  },
  /** The reader: page `page` (0-based) of `total` reached (the last page makes it read) */
  async save(chapterId: string, page: number, total: number): Promise<void> {
    await api.post(`/media/chapters/${chapterId}/reading`, { page, total })
  },
  /** « Marquer comme lu / non lu » */
  async mark(mediaId: string, chapterIds: string[], read: boolean): Promise<ChapterReading[]> {
    const { data } = await api.post<{ data: ChapterReading[] }>(`/media/${mediaId}/reading`, { chapterIds, read })
    return data.data
  },
}
