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
