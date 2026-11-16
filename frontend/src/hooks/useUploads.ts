import { useCallback, useRef, useState } from 'react'

/** A send in progress (Fichiers, Transferts): how far it is, and how to stop it */
export interface UploadJob {
  id:        string
  label:     string
  loaded:    number
  total:     number
  startedAt: number
}

export type Sender<T> = (onProgress: (loaded: number, total: number) => void, signal: AbortSignal) => Promise<T>

/**
 * Sends with live progress (at most every 200 ms) and « Annuler ». `run` resolves with the
 * answer, or null when cancelled; other errors are thrown.
 */
export function useUploads() {
  const [jobs, setJobs] = useState<UploadJob[]>([])
  const controllers = useRef(new Map<string, AbortController>())

  const run = useCallback(async <T,>(files: File[], send: Sender<T>): Promise<T | null> => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const ctrl = new AbortController()
    controllers.current.set(id, ctrl)
    const label = files.length === 1 ? files[0].name : `${files.length} fichiers`
    const total = files.reduce((s, f) => s + f.size, 0)
    setJobs((j) => [...j, { id, label, loaded: 0, total, startedAt: Date.now() }])
    let shownAt = 0
    const progress = (loaded: number, t: number) => {
      const now = Date.now()
      if (now - shownAt < 200 && loaded < t) return
      shownAt = now
      setJobs((j) => j.map((x) => (x.id === id ? { ...x, loaded, total: t || x.total } : x)))
    }
    try {
      return await send(progress, ctrl.signal)
    } catch (err) {
      if (ctrl.signal.aborted) return null
      throw err
    } finally {
      controllers.current.delete(id)
      setJobs((j) => j.filter((x) => x.id !== id))
    }
  }, [])

  const cancel = useCallback((id: string) => controllers.current.get(id)?.abort(), [])

  return { jobs, run, cancel }
}

/** « 3 min restantes », « moins d’une minute », « 1 h 20 min restantes » (null at the start) */
export function timeLeft(job: UploadJob, now = Date.now()): string | null {
  const elapsed = (now - job.startedAt) / 1000
  if (elapsed < 2 || job.loaded <= 0 || job.loaded >= job.total) return null
  const left = (job.total - job.loaded) / (job.loaded / elapsed)
  if (left < 60) return 'moins d’une minute'
  const min = Math.ceil(left / 60)
  if (min < 60) return `${min} min restantes`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min restantes`
}

/** The files of a drop, without the folders (a dropped folder arrives as an empty « file ») */
export function droppedFiles(dt: DataTransfer): { files: File[]; folders: number } {
  const files: File[] = []
  let folders = 0
  const items = Array.from(dt.items ?? [])
  if (items.length) {
    for (const item of items) {
      if (item.kind !== 'file') continue
      if (item.webkitGetAsEntry?.()?.isDirectory) { folders++; continue }
      const f = item.getAsFile()
      if (f) files.push(f)
    }
    return { files, folders }
  }
  return { files: Array.from(dt.files ?? []), folders }
}

/**
 * Drag & drop of files from the computer onto an element: `over` while files are above it.
 * `onFiles` gets the files (folders left out, their count given).
 */
export function useFileDrop(onFiles: (files: File[], folders: number) => void, enabled = true) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  const handlers = enabled ? {
    onDragEnter: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setOver(true) },
    onDragOver: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy' },
    onDragLeave: (e: React.DragEvent) => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false) },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setOver(false)
      const { files, folders } = droppedFiles(e.dataTransfer)
      onFiles(files, folders)
    },
  } : {}
  return { over, handlers }
}
