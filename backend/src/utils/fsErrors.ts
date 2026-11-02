import fs from 'fs'
import os from 'os'
import path from 'path'
import { AppError } from './errors'

let runAs = 'nexus'
try { runAs = os.userInfo().username } catch { /* unknown */ }

/**
 * Turn a Node.js file-system error (EACCES, ENOENT…) into a clear, user-facing
 * AppError. Returns null for anything that is not a file-system error.
 */
export function fsError(err: unknown, target?: string): AppError | null {
  const e = err as NodeJS.ErrnoException
  if (!e || typeof e.code !== 'string') return null
  const p    = target ?? e.path ?? ''
  const name = p ? `« ${path.basename(p) || p} »` : 'cet élément'
  switch (e.code) {
    case 'EACCES':
    case 'EPERM':
      return new AppError(
        `Permission refusée sur ${name} : il appartient à un autre utilisateur que celui de Nexus (${runAs}). ` +
        `Sur le serveur : sudo chown -R ${runAs}: "${path.dirname(p) || p}"`, 403)
    case 'ENOENT':    return new AppError(`${name} n'existe plus (déjà supprimé ou déplacé ?)`, 404)
    case 'EBUSY':     return new AppError(`${name} est en cours d'utilisation, réessaie dans un instant`, 409)
    case 'ENOTEMPTY': return new AppError(`Le dossier ${name} n'est pas vide`, 409)
    case 'EEXIST':    return new AppError(`${name} existe déjà`, 409)
    case 'EROFS':     return new AppError(`${name} est sur un disque en lecture seule`, 409)
    case 'EISDIR':    return new AppError(`${name} est un dossier`, 400)
    case 'ENOTDIR':   return new AppError(`${name} n'est pas un dossier`, 400)
    case 'ENAMETOOLONG': return new AppError('Nom de fichier trop long', 400)
    case 'ENOSPC':    return new AppError('Disque plein', 507)
    case 'EXDEV':     return new AppError('Déplacement impossible entre deux disques différents', 400)
    default:          return null
  }
}

/** Name of a local user id (from /etc/passwd), or the numeric id. */
function userName(uid: number): string {
  try {
    const line = fs.readFileSync('/etc/passwd', 'utf8').split('\n').find((l) => l.split(':')[2] === String(uid))
    if (line) return line.split(':')[0]
  } catch { /* not readable */ }
  return String(uid)
}

function writable(dir: string): boolean {
  try { fs.accessSync(dir, fs.constants.W_OK | fs.constants.X_OK); return true } catch { return false }
}

/**
 * Explain a permission error on deletion precisely: removing an entry needs
 * write access to the folder that CONTAINS it, so the blocking folder is the
 * parent (or, inside a folder deleted recursively, the folder of the file
 * that could not be removed). Names that folder and its real owner.
 */
export function deletePermissionError(target: string, err: NodeJS.ErrnoException): AppError {
  const failing = err.path && err.path !== target ? err.path : target
  let blocking = path.dirname(failing)
  if (writable(blocking) && failing !== target) blocking = failing
  let owner = '?'
  try { owner = userName(fs.statSync(blocking).uid) } catch { /* gone */ }
  const what = path.basename(target)
  const e = new AppError(
    `Impossible de supprimer « ${what} » : Nexus (utilisateur ${runAs}) n'a pas le droit d'écrire dans ` +
    `« ${blocking} », qui appartient à ${owner}. Sur le serveur : sudo chown -R ${runAs}: "${blocking}"`,
    403,
  )
  // Inside the media library, the UI can offer to force it with the sudo password
  if (runAs !== 'root' && inLibrary(target)) e.code = 'NEEDS_PASSWORD'
  return e
}

/** Media library folders (where a password-forced deletion is allowed). */
export function libraryRoots(): string[] {
  const roots = ['MEDIA_ROOT', 'FILMS_PATH', 'SERIES_PATH', 'ANIMES_PATH', 'MANGA_PATH', 'YOUTUBE_PATH']
    .map((k) => process.env[k]).filter((v): v is string => !!v)
  if (!process.env.MEDIA_ROOT) roots.push('/media')
  return [...new Set(roots.map((r) => path.resolve(r)))]
}

/** True when `p` is strictly inside one of `roots` (never a root itself). */
export function strictlyInside(roots: string[], p: string): boolean {
  return roots.some((r) => {
    const rel = path.relative(r, p)
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
  })
}

function inLibrary(p: string): boolean {
  return strictlyInside(libraryRoots(), path.resolve(p))
}
