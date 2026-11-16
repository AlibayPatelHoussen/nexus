import fs from 'fs'
import path from 'path'
import yazl from 'yazl'
import type { Response } from 'express'
import { logger } from '../utils/logger'
import { ValidationError } from '../utils/errors'
import { secretReason } from './files'
import { contentDisposition } from '../utils/contentDisposition'

/**
 * Fichiers › « Télécharger (.zip) »: several files or whole folders in one download. Stored
 * (not compressed: films and photos are already), so the size is known before the first byte
 * (the browser shows its progress) and nothing is written on the server. Inside the folders,
 * links are left out (never a way out of the folder) and so are secrets (.env, keys…).
 */

export interface ZipItem { file: string; name: string; size: number; mtime: Date; mode: number }
export interface ZipPlan { files: ZipItem[]; dirs: string[]; bytes: number }

const MAX_FILES = 100_000

/** The files of `roots` (absolute, already checked), named inside the zip from their own name */
export async function planZip(roots: string[]): Promise<ZipPlan> {
  const plan: ZipPlan = { files: [], dirs: [], bytes: 0 }
  const used = new Set<string>()

  const visit = async (abs: string, name: string, stat: fs.Stats): Promise<void> => {
    if (secretReason(abs)) return
    if (stat.isFile()) {
      try { await fs.promises.access(abs, fs.constants.R_OK) } catch { return }
      if (plan.files.length >= MAX_FILES) throw new ValidationError(`Trop de fichiers pour un seul .zip (${MAX_FILES.toLocaleString('fr-FR')} au plus)`)
      plan.files.push({ file: abs, name, size: stat.size, mtime: stat.mtime, mode: stat.mode })
      plan.bytes += stat.size
      return
    }
    if (!stat.isDirectory()) return
    let list: fs.Dirent[]
    try { list = await fs.promises.readdir(abs, { withFileTypes: true }) } catch { return }
    list.sort((a, b) => a.name.localeCompare(b.name))
    const before = plan.files.length + plan.dirs.length
    for (const d of list) {
      if (d.isSymbolicLink()) continue
      const child = path.join(abs, d.name)
      const st = await fs.promises.lstat(child).catch(() => null)
      if (st) await visit(child, `${name}/${d.name}`, st)
    }
    if (plan.files.length + plan.dirs.length === before) plan.dirs.push(name)
  }

  for (const root of roots) {
    // The chosen items themselves may be links (a disk mounted elsewhere): followed
    const stat = await fs.promises.stat(root).catch(() => null)
    if (!stat) continue
    // Two items with the same name (from different folders): « nom (2) »
    const base = path.basename(root) || 'racine'
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const ext = stat.isFile() ? path.extname(base) : ''
      name = `${base.slice(0, base.length - ext.length)} (${n})${ext}`
    }
    used.add(name.toLowerCase())
    await visit(root, name, stat)
  }
  return plan
}

/** « Films.zip » for one folder, else « Nexus-2026-11-16.zip » */
export function zipName(roots: string[]): string {
  const one = roots.length === 1 ? path.basename(roots[0]) : ''
  const base = one ? one.replace(/\.[^.]+$/, '') || one : `Nexus-${new Date().toISOString().slice(0, 10)}`
  return `${base}.zip`
}

export function sendZip(res: Response, plan: ZipPlan, name: string) {
  const zip = new yazl.ZipFile()
  for (const d of plan.dirs) zip.addEmptyDirectory(d)
  for (const f of plan.files) {
    zip.addReadStreamLazy(f.name, { compress: false, size: f.size, mtime: f.mtime, mode: f.mode },
      (cb) => cb(null, fs.createReadStream(f.file)))
  }
  let failed = false
  zip.on('error', (err: Error) => {
    // Headers are sent: the download is cut, the browser says it failed (never a broken zip)
    failed = true
    logger.warn(`Zip download: ${err.message}`)
    res.destroy(err)
  })
  // (yazl gives the size to this callback, its types forget it; -1 when unknown)
  const ready = (total: number) => {
    if (failed) return
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', contentDisposition(name))
    res.setHeader('Cache-Control', 'private, no-store')
    if (total >= 0) res.setHeader('Content-Length', String(total))
    zip.outputStream.pipe(res)
  }
  zip.end({ forceZip64Format: false, comment: '' }, ready as unknown as () => void)
  res.on('close', () => { if (!res.writableFinished) zip.outputStream.unpipe(res) })
}
