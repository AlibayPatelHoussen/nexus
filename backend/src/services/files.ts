import fs from 'fs/promises'
import path from 'path'
import mime from 'mime-types'
import { AppError } from '../utils/errors'
import { deletePermissionError, fsError } from '../utils/fsErrors'
import { canSudo, isPermissionError, owner, sudo, sudoRun, withSudo } from '../utils/sudo'

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

function sortEntries(entries: FileEntry[]): FileEntry[] {
  // Directories first, then alphabetical
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/** Lists a folder Nexus cannot read, with sudo (administrator mode). */
async function sudoList(dir: string): Promise<FileEntry[]> {
  const out = await sudoRun(['find', dir, '-mindepth', '1', '-maxdepth', '1', '-printf', '%Y\\t%s\\t%T@\\t%m\\t%f\\0'])
  return out.toString('utf8').split('\0').filter(Boolean).map((line) => {
    const [kind, size, mtime, mode, ...rest] = line.split('\t')
    const name = rest.join('\t')
    const isDir = kind === 'd'
    const ext = isDir ? null : path.extname(name).toLowerCase()
    const date = new Date(Number(mtime) * 1000).toISOString()
    return {
      name, path: path.join(dir, name), type: isDir ? 'directory' : 'file',
      size: isDir ? null : Number(size), mimeType: ext ? (mime.lookup(name) || null) : null, extension: ext,
      modified: date, created: date, permissions: mode,
    } satisfies FileEntry
  })
}

/** mkdir -p; with sudo if needed (the new folder then belongs to the Nexus account). */
async function mkdirp(dir: string): Promise<void> {
  const [uid, gid] = owner.split(':')
  await withSudo(
    () => fs.mkdir(dir, { recursive: true }).then(() => undefined),
    () => sudoRun(['install', '-d', '-o', uid, '-g', gid, '--', dir]).then(() => undefined),
  ).catch((err) => { throw fsError(err, dir) ?? err })
}

/** Writes a file; with sudo if needed. A NEW file belongs to the Nexus account, an existing one keeps its owner. */
async function write(file: string, content: string): Promise<void> {
  await withSudo(
    () => fs.writeFile(file, content, 'utf8'),
    async () => {
      const existed = (await sudo(['test', '-e', file])).code === 0
      await sudoRun(['dd', `of=${file}`, 'status=none'], content)
      if (!existed) await sudoRun(['chown', owner, '--', file])
    },
  ).catch((err) => { throw fsError(err, file) ?? err })
}

/** rename / move; with sudo if needed (mv also handles moves between disks). */
async function mv(src: string, dest: string): Promise<void> {
  await withSudo(
    () => fs.rename(src, dest),
    () => sudoRun(['mv', '-T', '--', src, dest]).then(() => undefined),
  ).catch((err) => { throw fsError(err, src) ?? err })
}

export class FilesService {
  static async list(dirPath: string): Promise<FileEntry[]> {
    const safe = sanitizePath(dirPath)

    let entries
    try {
      entries = await fs.readdir(safe, { withFileTypes: true })
    } catch (err) {
      if (isPermissionError(err) && await canSudo()) return sortEntries(await sudoList(safe))
      throw fsError(err, safe) ?? err
    }
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

    return sortEntries(results)
  }

  static async createDir(dirPath: string): Promise<void> {
    await mkdirp(sanitizePath(dirPath))
  }

  static async createFile(filePath: string, content = ''): Promise<void> {
    const safe = sanitizePath(filePath)
    await mkdirp(path.dirname(safe))
    await write(safe, content)
  }

  static async rename(oldPath: string, newName: string): Promise<void> {
    const safe = sanitizePath(oldPath)
    assertNotProtected(safe)
    if (!newName || newName !== path.basename(newName) || newName === '.' || newName === '..') {
      throw new AppError('Invalid name', 422)
    }
    const newPath = path.join(path.dirname(safe), newName)
    await mv(safe, newPath)
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
      if (isPermissionError(err)) {
        // Administrator mode: same deletion with sudo (rights are the only problem)
        if (await canSudo()) { await sudoRun(['rm', '-rf', '--one-file-system', '--', safe]); return }
        throw deletePermissionError(safe, err as NodeJS.ErrnoException)
      }
      throw fsError(err, safe) ?? err
    }
  }

  /** Delete several entries; every failure is reported, none blocks the others. */
  static async deleteMany(paths: string[]): Promise<{ deleted: string[]; failed: { path: string; error: string; code?: string }[] }> {
    const results = await Promise.allSettled(paths.map((p) => FilesService.delete(p)))
    const deleted: string[] = []
    const failed: { path: string; error: string; code?: string }[] = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') deleted.push(paths[i])
      else {
        const code = (r.reason as AppError)?.code
        failed.push({ path: paths[i], error: (r.reason as Error)?.message || 'Erreur inconnue', ...(code ? { code } : {}) })
      }
    })
    return { deleted, failed }
  }

  static async move(srcPath: string, destPath: string): Promise<void> {
    const src = sanitizePath(srcPath)
    assertNotProtected(src)
    await mv(src, sanitizePath(destPath))
  }

  static async readFile(filePath: string): Promise<string> {
    const safe = sanitizePath(filePath)
    const tooBig = () => new AppError('File too large to read (>10MB)', 413)
    try {
      const stat = await fs.stat(safe)
      if (stat.size > 10 * 1024 * 1024) throw tooBig()
      return await fs.readFile(safe, 'utf8')
    } catch (err) {
      if (!isPermissionError(err) || !(await canSudo())) throw fsError(err, safe) ?? err
      const size = Number((await sudoRun(['stat', '-L', '-c', '%s', '--', safe])).toString().trim())
      if (size > 10 * 1024 * 1024) throw tooBig()
      return (await sudoRun(['cat', '--', safe])).toString('utf8')
    }
  }

  static async writeFile(filePath: string, content: string): Promise<void> {
    await write(sanitizePath(filePath), content)
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
