import { execFile } from 'child_process'
import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import sharp from 'sharp'
import { IMAGE_EXTS, archivePages, chapterKind } from './chapters'
import { logger } from '../utils/logger'

/**
 * Manga pages ready to read, like manga sites serve them: each page (image
 * folder, CBZ or PDF) converted once to a light WebP at the reader's width,
 * kept on disk. A 2 MB scan becomes ~150–300 KB; PDFs no longer have to be
 * downloaded and drawn by the phone.
 */

const run = promisify(execFile)
const CACHE_DIR = process.env.PAGE_CACHE_DIR || path.resolve(__dirname, '../../cache/pages')
const MAX_JOBS = Math.max(1, Number(process.env.PAGE_JOBS) || 2)   // conversions at the same time

/** Reader widths: a few steps so every screen shares the same cached files. */
export function pageWidth(raw: unknown): number {
  const w = Number(raw) || 1080
  return Math.min(1600, Math.max(480, Math.round(w / 160) * 160))
}

let pdfTools: boolean | null = null
/** pdftoppm / pdfinfo (poppler-utils) installed on the server? */
export async function hasPdfTools(): Promise<boolean> {
  if (pdfTools !== null) return pdfTools
  try { await run('pdfinfo', ['-v']); pdfTools = true } catch (e) {
    pdfTools = (e as NodeJS.ErrnoException).code !== 'ENOENT'   // -v exits non-zero on some versions
  }
  if (!pdfTools) logger.warn('poppler-utils (pdftoppm) missing: PDF chapters are drawn by the phone instead of the server')
  return pdfTools
}

const counts = new Map<string, number>()
export async function pdfPageCount(file: string): Promise<number> {
  const st = await fs.stat(file)
  const key = `${file}:${st.mtimeMs}`
  const known = counts.get(key)
  if (known) return known
  const { stdout } = await run('pdfinfo', [file])
  const n = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1] ?? 0)
  if (!n) throw new Error('PDF sans page')
  counts.set(key, n)
  return n
}

/** Sorted image files of a chapter folder (natural order 1, 2, …, 10). */
export async function folderPages(dir: string): Promise<string[]> {
  return (await fs.readdir(dir))
    .filter((f) => IMAGE_EXTS.includes(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

/** Original image of page n (1-based), at least `width` wide for PDFs. */
async function source(chapterPath: string, n: number, width: number): Promise<Buffer> {
  switch (chapterKind(chapterPath)) {
    case 'pdf': {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-page-'))
      try {
        const out = path.join(tmp, 'p')
        await run('pdftoppm', ['-f', String(n), '-l', String(n), '-scale-to-x', String(width), '-scale-to-y', '-1',
          '-jpeg', '-jpegopt', 'quality=92', '-singlefile', chapterPath, out], { timeout: 60_000 })
        return await fs.readFile(`${out}.jpg`)
      } finally { await fs.rm(tmp, { recursive: true, force: true }) }
    }
    case 'archive': {
      const { zip, pages } = await archivePages(chapterPath)
      const data = pages[n - 1] && zip.readFile(pages[n - 1])
      if (!data) throw Object.assign(new Error('Page introuvable'), { status: 404 })
      return data
    }
    default: {
      const files = await folderPages(chapterPath)
      if (!files[n - 1]) throw Object.assign(new Error('Page introuvable'), { status: 404 })
      return fs.readFile(path.join(chapterPath, files[n - 1]))
    }
  }
}

// Small queue: an old server CPU stays responsive while pages are prepared
let active = 0
const waiting: (() => void)[] = []
async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (active >= MAX_JOBS) await new Promise<void>((ok) => waiting.push(ok))
  active++
  try { return await job() } finally { active--; waiting.shift()?.() }
}

const inflight = new Map<string, Promise<string>>()

/** Path of the ready-to-serve WebP of page n (converted once, then from disk). */
export async function pageImage(chapterId: string, chapterPath: string, n: number, width: number): Promise<string> {
  const st = await fs.stat(chapterPath)
  const version = crypto.createHash('sha1').update(`${chapterPath}:${st.mtimeMs}:${st.size}`).digest('hex').slice(0, 10)
  const file = path.join(CACHE_DIR, chapterId, `${n}-${width}-${version}.webp`)
  try { await fs.access(file); return file } catch { /* not converted yet */ }

  const running = inflight.get(file)
  if (running) return running
  const job = slot(async () => {
    const original = await source(chapterPath, n, width)
    await fs.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await sharp(original, { failOn: 'none' })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78, effort: 3 })
      .toFile(tmp)
    await fs.rename(tmp, file)
    return file
  })
  inflight.set(file, job)
  try { return await job } finally { inflight.delete(file) }
}

/** Prepares the next pages in the background while the reader looks at page n. */
export function warmNext(chapterId: string, chapterPath: string, n: number, width: number, total: number, ahead = 3) {
  for (let k = n + 1; k <= Math.min(total, n + ahead); k++) {
    pageImage(chapterId, chapterPath, k, width).catch((e) => logger.debug?.(`warm page ${k}: ${(e as Error).message}`))
  }
}

/** Number of pages of a chapter (any kind). */
export async function pageCount(chapterPath: string): Promise<number> {
  switch (chapterKind(chapterPath)) {
    case 'pdf': return pdfPageCount(chapterPath)
    case 'archive': return (await archivePages(chapterPath)).pages.length
    default: return (await folderPages(chapterPath)).length
  }
}
