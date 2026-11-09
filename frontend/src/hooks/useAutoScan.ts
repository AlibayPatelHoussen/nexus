import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'

/** Library type → the library scan that covers it. */
export const scanTypeOf = (type: string | undefined): string | null => ({
  film: 'films', serie: 'series', anime: 'animes', manga: 'manga', webtoon: 'manga', youtube: 'youtube',
} as Record<string, string>)[type ?? ''] ?? null

/**
 * Each time a library page (or a title page) opens: a quick scan of that library on the
 * server (new files, new episodes / chapters), then the page refreshes itself. The server
 * skips it while another scan runs or when it scanned that library less than 30 s ago.
 */
export function useAutoScan(scanType: string | null) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!scanType) return
    let cancelled = false
    api.post<{ data: { scanned?: number; skipped?: string } }>(`/media/scan/${scanType}/auto`)
      .then(({ data }) => {
        // « À la une » keeps its draw (key ['featured', …], outside ['media'])
        if (!cancelled && data.data.scanned != null) void qc.invalidateQueries({ queryKey: ['media'] })
      })
      .catch(() => { /* the page works without it */ })
    return () => { cancelled = true }
  }, [scanType, qc])
}
