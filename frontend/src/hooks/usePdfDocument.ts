import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { getMeta, getPage, putMeta, putPage } from '@/services/readerCache'

export interface PdfDocument {
  numPages: number
  error:    string | null
  /** Width / height of a page (1-based), once known */
  ratio:    (n: number) => number
  /** Image URL of a page: from the device cache, or drawn by PDF.js (one at a time) */
  render:   (n: number) => Promise<string>
}

/**
 * PDF chapters read with PDF.js (Mozilla's PDF reader, works in Safari).
 *
 * - The server sends the PDF piece by piece (Range): PDF.js only fetches
 *   what the page being drawn needs, so the first page arrives first.
 * - Drawn pages are kept on the device (readerCache): coming back to a
 *   chapter shows them without downloading again — when every page is
 *   cached, the PDF is not even opened.
 */
export function usePdfDocument(url: string | null, chapterId: string | undefined): PdfDocument {
  const [numPages, setNumPages] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const ratios = useRef(new Map<number, number>())
  const pages = useRef(new Map<number, Promise<string>>())
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const urls = useRef<string[]>([])
  const docRef = useRef<Promise<PDFDocumentProxy> | null>(null)
  const destroy = useRef<(() => void) | null>(null)

  const saveMeta = useCallback((count: number) => {
    if (!chapterId) return
    void putMeta(chapterId, { kind: 'pdf', numPages: count, ratios: Object.fromEntries(ratios.current) })
  }, [chapterId])

  /** Opens the PDF once, only when a page is not in the cache. */
  const openDoc = useCallback((): Promise<PDFDocumentProxy> => {
    if (docRef.current) return docRef.current
    if (!url) return Promise.reject(new Error('aucun PDF'))
    docRef.current = (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      const task = pdfjs.getDocument({
        url,
        isEvalSupported: false,
        disableStream: true,      // no full download in the background…
        disableAutoFetch: true,   // …only the pieces the drawn pages need
        rangeChunkSize: 256 * 1024,
      })
      destroy.current = () => { void task.destroy() }
      return task.promise
    })()
    docRef.current.catch(() => { docRef.current = null })
    return docRef.current
  }, [url])

  useEffect(() => {
    setNumPages(0); setError(null)
    ratios.current = new Map(); pages.current = new Map(); docRef.current = null
    if (!url) return
    let cancelled = false
    ;(async () => {
      try {
        const meta = chapterId ? await getMeta(chapterId) : null
        if (meta?.kind === 'pdf' && meta.numPages > 0) {
          for (const [n, r] of Object.entries(meta.ratios ?? {})) ratios.current.set(Number(n), r)
          if (!cancelled) setNumPages(meta.numPages)
          return
        }
        const doc = await openDoc()
        const first = await doc.getPage(1)
        const vp = first.getViewport({ scale: 1 })
        ratios.current.set(1, vp.width / vp.height)
        if (cancelled) return
        setNumPages(doc.numPages)
        saveMeta(doc.numPages)
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'PDF illisible')
      }
    })()
    return () => {
      cancelled = true
      destroy.current?.(); destroy.current = null
      urls.current.forEach((u) => URL.revokeObjectURL(u))
      urls.current = []
    }
  }, [url, chapterId, openDoc, saveMeta])

  const ratio = useCallback((n: number) => ratios.current.get(n) ?? ratios.current.get(1) ?? 1 / 1.414, [])

  const render = useCallback((n: number): Promise<string> => {
    const known = pages.current.get(n)
    if (known) return known
    const job = queue.current.then(async () => {
      const cached = chapterId ? await getPage(chapterId, n) : null
      let blob = cached
      if (!blob) {
        const doc = await openDoc()
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
        blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.88))
        canvas.width = 0; canvas.height = 0   // free the bitmap right away (iOS memory)
        if (!blob) throw new Error('Affichage impossible (image)')
        if (chapterId) { void putPage(chapterId, n, blob); saveMeta(doc.numPages) }
      }
      const u = URL.createObjectURL(blob)
      urls.current.push(u)
      return u
    })
    queue.current = job.catch(() => undefined)
    pages.current.set(n, job)
    job.catch(() => pages.current.delete(n))
    return job
  }, [chapterId, openDoc, saveMeta])

  return { numPages, error, ratio, render }
}
