import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface PdfDocument {
  numPages: number
  /** Download progress 0–1 (null when the size is unknown) */
  progress: number | null
  error:    string | null
  /** Width / height of a page (1-based), once known */
  ratio:    (n: number) => number
  /** Renders a page to an image URL (cached; one page at a time) */
  render:   (n: number) => Promise<string>
}

/**
 * PDF chapters, read with PDF.js (Mozilla's PDF reader) — works in Safari on
 * iPhone, unlike a PDF inside an iframe.
 *
 * The file is downloaded in one go (disableRange): the server answers
 * range requests with the whole file, which makes PDF.js and Safari's own
 * reader fail on big PDFs. Pages are drawn only when asked (when they come
 * near the screen), so a 200-page volume does not fill the phone's memory.
 */
export function usePdfDocument(url: string | null): PdfDocument {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ratios = useRef(new Map<number, number>())
  const cache = useRef(new Map<number, Promise<string>>())
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const urls = useRef<string[]>([])

  useEffect(() => {
    setDoc(null); setNumPages(0); setProgress(null); setError(null)
    ratios.current = new Map(); cache.current = new Map()
    if (!url) return
    let cancelled = false
    let task: { destroy: () => Promise<void> } | null = null
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        const loading = pdfjs.getDocument({ url, disableRange: true, isEvalSupported: false })
        task = loading
        loading.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
          if (!cancelled) setProgress(total ? Math.min(1, loaded / total) : null)
        }
        const d = await loading.promise
        if (cancelled) return
        // Page proportions first (cheap): placeholders keep their size while scrolling
        const first = await d.getPage(1)
        const vp = first.getViewport({ scale: 1 })
        ratios.current.set(1, vp.width / vp.height)
        setDoc(d)
        setNumPages(d.numPages)
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'PDF illisible')
      }
    })()

    return () => {
      cancelled = true
      void task?.destroy()
      urls.current.forEach((u) => URL.revokeObjectURL(u))
      urls.current = []
    }
  }, [url])

  const ratio = useCallback((n: number) => ratios.current.get(n) ?? ratios.current.get(1) ?? 1 / 1.414, [])

  const render = useCallback((n: number): Promise<string> => {
    if (!doc) return Promise.reject(new Error('PDF pas encore chargé'))
    const hit = cache.current.get(n)
    if (hit) return hit
    const job = queue.current.then(async () => {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      ratios.current.set(n, base.width / base.height)
      // Sharp on the screen without wasting memory
      const target = Math.min(1600, Math.round(Math.min(window.innerWidth, 900) * Math.min(window.devicePixelRatio || 1, 2)))
      const viewport = page.getViewport({ scale: target / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Affichage impossible (canvas)')
      await page.render({ canvasContext: ctx, viewport }).promise
      page.cleanup()
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.88))
      canvas.width = 0; canvas.height = 0   // free the bitmap right away (iOS memory)
      if (!blob) throw new Error('Affichage impossible (image)')
      const u = URL.createObjectURL(blob)
      urls.current.push(u)
      return u
    })
    queue.current = job.catch(() => undefined)
    cache.current.set(n, job)
    job.catch(() => cache.current.delete(n))
    return job
  }, [doc])

  return { numPages, progress, error, ratio, render }
}
