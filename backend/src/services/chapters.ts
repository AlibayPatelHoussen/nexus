import fs from 'fs/promises'
import path from 'path'
import AdmZip from 'adm-zip'

export const IMAGE_EXTS   = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']
export const ARCHIVE_EXTS = ['.cbz', '.zip']
export type ChapterKind = 'images' | 'pdf' | 'archive'

export interface FoundChapter {
  path: string
  name: string
  kind: ChapterKind
  pageCount: number | null
}

const isImage   = (f: string) => IMAGE_EXTS.includes(path.extname(f).toLowerCase())
const natural   = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

export function chapterKind(p: string): ChapterKind {
  const ext = path.extname(p).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ARCHIVE_EXTS.includes(ext)) return 'archive'
  return 'images'
}

/**
 * Find every chapter of a manga folder, whatever the layout:
 * - a folder containing images (at any depth, max 4 levels),
 * - a .pdf file, a .cbz / .zip archive (anywhere in the tree),
 * - images directly in the manga folder (one-shot) → a single chapter.
 */
export async function findChapters(root: string): Promise<FoundChapter[]> {
  const out: FoundChapter[] = []

  async function walk(dir: string, depth: number) {
    let entries: import('fs').Dirent[]
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    entries = entries.filter((e) => !e.name.startsWith('.'))

    const images = entries.filter((e) => e.isFile() && isImage(e.name))
    if (images.length) out.push({ path: dir, name: path.basename(dir), kind: 'images', pageCount: images.length })

    for (const e of entries.filter((e) => e.isFile())) {
      const kind = chapterKind(e.name)
      if (kind === 'pdf' || kind === 'archive') {
        out.push({ path: path.join(dir, e.name), name: path.basename(e.name, path.extname(e.name)), kind, pageCount: null })
      }
    }
    if (depth < 4) {
      for (const e of entries.filter((e) => e.isDirectory()).sort((a, b) => natural(a.name, b.name))) {
        await walk(path.join(dir, e.name), depth + 1)
      }
    }
  }

  await walk(root, 0)
  return out.sort((a, b) => natural(a.path, b.path))
}

// ── CBZ / ZIP pages ───────────────────────────────────
const zipCache = new Map<string, { mtime: number; zip: AdmZip; pages: string[] }>()

/** Image entries of an archive, in reading order (kept open for a few archives). */
export async function archivePages(file: string): Promise<{ zip: AdmZip; pages: string[] }> {
  const { mtimeMs } = await fs.stat(file)
  const hit = zipCache.get(file)
  if (hit && hit.mtime === mtimeMs) return hit

  const zip   = new AdmZip(file)
  const pages = zip.getEntries()
    .filter((e) => !e.isDirectory && isImage(e.entryName) && !e.entryName.split('/').some((p) => p.startsWith('.') || p === '__MACOSX'))
    .map((e) => e.entryName)
    .sort(natural)

  zipCache.set(file, { mtime: mtimeMs, zip, pages })
  while (zipCache.size > 3) zipCache.delete(zipCache.keys().next().value as string)
  return { zip, pages }
}
