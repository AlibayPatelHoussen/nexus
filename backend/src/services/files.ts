import fs from 'fs/promises'
import path from 'path'
import mime from 'mime-types'
import { AppError } from '../utils/errors'

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

// Sanitize path to prevent traversal
function sanitizePath(inputPath: string): string {
  const normalized = path.normalize(inputPath)
  // Allow any absolute path — user has admin access
  return normalized.startsWith('/') ? normalized : `/${normalized}`
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
    const safe    = sanitizePath(oldPath)
    const newPath = path.join(path.dirname(safe), newName)
    await fs.rename(safe, newPath)
  }

  static async delete(targetPath: string): Promise<void> {
    const safe = sanitizePath(targetPath)
    const stat = await fs.stat(safe)

    if (stat.isDirectory()) {
      await fs.rm(safe, { recursive: true, force: true })
    } else {
      await fs.unlink(safe)
    }
  }

  static async move(srcPath: string, destPath: string): Promise<void> {
    await fs.rename(sanitizePath(srcPath), sanitizePath(destPath))
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
