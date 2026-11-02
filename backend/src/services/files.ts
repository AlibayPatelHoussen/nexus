import fs from 'fs/promises'
import path from 'path'
import mime from 'mime-types'
import { AppError } from '../utils/errors'
import { fsError } from '../utils/fsErrors'

export interface FileEntry {
  name:      string
  path:      string
  type:      'file' | 'directory'
  size:      number | null
  mimeType:  string | null
  extension: string | null
  modified:  string
  created:   string
  permissions: string
}

/**
 * Root the file manager is confined to (FILES_ROOT, default "/": the file
 * manager is admin-only). Paths are resolved first, so "../" can never escape it.
 */
const FILES_ROOT = path.resolve(process.env.FILES_ROOT || '/')

export function sanitizePath(inputPath: string): string {
  if (typeof inputPath !== 'string' || inputPath.includes('\0')) throw new AppError('Chemin invalide', 400)
  const resolved = path.resolve('/', inputPath)
  const rel = path.relative(FILES_ROOT, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new AppError(`Accès refusé : en dehors du dossier autorisé (${FILES_ROOT})`, 403)
  }
  return resolved
}

/** System folders that must never be deleted or moved from the web UI. */
const PROTECTED = new Set([
  '/', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/lib64', '/opt', '/proc', '/root',
  '/run', '/sbin', '/srv', '/sys', '/tmp', '/usr', '/var', '/media', '/mnt',
  path.resolve(__dirname, '../../..'),          // the Nexus installation itself
  FILES_ROOT,
  // Library roots: delete their content, not the library folders themselves
  ...['MEDIA_ROOT', 'FILMS_PATH', 'SERIES_PATH', 'ANIMES_PATH', 'MANGA_PATH', 'SCRIPTS_PATH']
    .map((k) => process.env[k]).filter((v): v is string => !!v).map((v) => path.resolve(v)),
])

export function assertNotProtected(p: string): void {
  if (PROTECTED.has(p)) throw new AppError(`« ${p} » est un dossier système protégé`, 403)
}

/**
 * True when `target` (after resolving symlinks) is `root` or inside it.
 * Used to confine non-admin users to the media library.
 */
export async function isInsideDir(root: string, target: string): Promise<boolean> {
  try {
    const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)])
    const rel = path.relative(realRoot, realTarget)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  } catch {
    return false
  }
}

export class FilesService {
  static async list(dirPath: string): Promise<FileEntry[]> {
    const safe = sanitizePath(dirPath)

    const entries = await fs.readdir(safe, { withFileTypes: true })
    const results: FileEntry[] = []

    for (const entry of entries) {
      const fullPath = path.join(safe, entry.name)

      try {
        const stat = await fs.stat(fullPath)
        const ext  = entry.isFile() ? path.extname(entry.name).toLowerCase() : null

        results.push({
          name:        entry.name,
          path:        fullPath,
          type:        entry.isDirectory() ? 'directory' : 'file',
          size:        entry.isFile() ? stat.size : null,
          mimeType:    ext ? (mime.lookup(entry.name) || null) : null,
          extension:   ext,
          modified:    stat.mtime.toISOString(),
          created:     stat.birthtime.toISOString(),
          permissions: (stat.mode & 0o777).toString(8),
        })
      } catch {
        // Skip files we can't stat
      }
    }

    // Directories first, then alphabetical
    return results.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  static async createDir(dirPath: string): Promise<void> {
    await fs.mkdir(sanitizePath(dirPath), { recursive: true })
  }

  static async createFile(filePath: string, content = ''): Promise<void> {
    const safe = sanitizePath(filePath)
    await fs.mkdir(path.dirname(safe), { recursive: true })
    await fs.writeFile(safe, content, 'utf8')
  }

  static async rename(oldPath: string, newName: string): Promise<void> {
    const safe = sanitizePath(oldPath)
    assertNotProtected(safe)
    if (!newName || newName !== path.basename(newName) || newName === '.' || newName === '..') {
      throw new AppError('Invalid name', 422)
    }
    const newPath = path.join(path.dirname(safe), newName)
    await fs.rename(safe, newPath)
  }

  static async delete(targetPath: string): Promise<void> {
    const safe = sanitizePath(targetPath)
    assertNotProtected(safe)
    try {
      // lstat: a symlink (even broken) is removed itself, never its target
      const stat = await fs.lstat(safe)
      if (stat.isDirectory()) await fs.rm(safe, { recursive: true, force: true, maxRetries: 2 })
      else await fs.unlink(safe)
    } catch (err) {
      throw fsError(err, safe) ?? err
    }
  }

  /** Delete several entries; every failure is reported, none blocks the others. */
  static async deleteMany(paths: string[]): Promise<{ deleted: string[]; failed: { path: string; error: string }[] }> {
    const results = await Promise.allSettled(paths.map((p) => FilesService.delete(p)))
    const deleted: string[] = []
    const failed: { path: string; error: string }[] = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') deleted.push(paths[i])
      else failed.push({ path: paths[i], error: (r.reason as Error)?.message || 'Erreur inconnue' })
    })
    return { deleted, failed }
  }

  static async move(srcPath: string, destPath: string): Promise<void> {
    const src = sanitizePath(srcPath)
    assertNotProtected(src)
    try {
      await fs.rename(src, sanitizePath(destPath))
    } catch (err) {
      throw fsError(err, src) ?? err
    }
  }

  static async readFile(filePath: string): Promise<string> {
    const safe = sanitizePath(filePath)
    const stat = await fs.stat(safe)

    if (stat.size > 10 * 1024 * 1024) {
      throw new AppError('File too large to read (>10MB)', 413)
    }

    return fs.readFile(safe, 'utf8')
  }

  static async writeFile(filePath: string, content: string): Promise<void> {
    await fs.writeFile(sanitizePath(filePath), content, 'utf8')
  }

  static async getInfo(filePath: string): Promise<FileEntry> {
    const safe = sanitizePath(filePath)
    const stat = await fs.stat(safe)
    const name = path.basename(safe)
    const ext  = stat.isFile() ? path.extname(name).toLowerCase() : null

    return {
      name,
      path:        safe,
      type:        stat.isDirectory() ? 'directory' : 'file',
      size:        stat.isFile() ? stat.size : null,
      mimeType:    ext ? (mime.lookup(name) || null) : null,
      extension:   ext,
      modified:    stat.mtime.toISOString(),
      created:     stat.birthtime.toISOString(),
      permissions: (stat.mode & 0o777).toString(8),
    }
  }
}
