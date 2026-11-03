import { useEffect, useState } from 'react'

export interface RenderedPage { url: string; name: string }

/**
 * Turns a PDF chapter into page images (pdf.js, in the browser), so PDFs
 * read like image chapters: vertical scroll, page by page, swipe…
 * Safari on iPhone cannot show a PDF inside a page (blank iframe).
 * Pages appear one after the other while the rest renders.
 */
export function usePdfPages(url: string | null) {
  const [pages, setPages] = useState<RenderedPage[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPages([]); setTotal(0); setError(null)
    if (!url) return
    let cancelled = false
    const created: string[] = []

    ;(async () => {
      try {
        // Legacy build: works on older Safari versions too; loaded only for PDF chapters
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        const doc = await pdfjs.getDocument({ url, isEvalSupported: false }).promise
        if (cancelled) return
        setTotal(doc.numPages)
        // Sharp on the screen without wasting memory
        const target = Math.min(1600, Math.round(Math.min(window.innerWidth, 900) * Math.min(window.devicePixelRatio || 1, 2)))
        for (let n = 1; n <= doc.numPages && !cancelled; n++) {
          const page = await doc.getPage(n)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: target / base.width })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('canvas indisponible')
          await page.render({ canvasContext: ctx, viewport }).promise
          const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.88))
          page.cleanup()
          if (!blob || cancelled) break
          const u = URL.createObjectURL(blob)
          created.push(u)
          setPages((p) => [...p, { url: u, name: `page-${n}` }])
        }
        void doc.destroy()
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'PDF illisible')
      }
    })()

    return () => {
      cancelled = true
      created.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [url])

  return { pages, total, error, loading: !!url && !error && pages.length < total || (!!url && !error && total === 0) }
}
