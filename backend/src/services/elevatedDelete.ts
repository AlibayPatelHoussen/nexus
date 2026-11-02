import { spawn } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { AppError } from '../utils/errors'
import { libraryRoots, strictlyInside } from '../utils/fsErrors'
import { logger } from '../utils/logger'
import { assertNotProtected, sanitizePath } from './files'

/**
 * Deletion forced with the server account's sudo password, for library
 * entries Nexus cannot delete itself (owned by root…).
 *
 * Safety:
 * - only inside the media library (MEDIA_ROOT, FILMS_PATH…), never a library
 *   folder itself nor a protected system folder; symlinks in the path are
 *   resolved before the check, so they cannot point the deletion elsewhere;
 * - the password is passed to sudo on stdin, used once, never stored or logged;
 * - `sudo -k` ignores any cached sudo session: the password is always checked;
 * - the route is rate-limited (see sudoLimiter).
 */

const SUDO_TIMEOUT_MS = 120_000

/** Validates a path and returns it with symlinks of its parent folders resolved. */
async function checkTarget(input: string): Promise<string> {
  const safe = sanitizePath(input)
  assertNotProtected(safe)
  let real: string
  try {
    real = path.join(await fs.realpath(path.dirname(safe)), path.basename(safe))
    await fs.lstat(real)
  } catch {
    throw new AppError(`« ${path.basename(safe)} » n'existe plus (déjà supprimé ou déplacé ?)`, 404)
  }
  assertNotProtected(real)
  const roots = await Promise.all(libraryRoots().map((r) => fs.realpath(r).catch(() => r)))
  // Never a library folder itself, nor a category folder (films, animes…) of MEDIA_ROOT
  const mediaRoot = await fs.realpath(path.resolve(process.env.MEDIA_ROOT || '/media')).catch(() => '')
  if (roots.includes(real) || (mediaRoot && path.dirname(real) === mediaRoot)) {
    throw new AppError(`« ${real} » est un dossier de la bibliothèque : supprime son contenu, pas le dossier`, 403)
  }
  if (!strictlyInside(roots, real)) {
    throw new AppError(
      `La suppression avec mot de passe n'est possible que dans la bibliothèque (${roots.join(', ')}), pas pour « ${real} »`,
      403,
    )
  }
  return real
}

interface SudoResult { code: number | null; stderr: string }

function runSudo(password: string, args: string[]): Promise<SudoResult> {
  return new Promise((resolve, reject) => {
    // -S password on stdin, -k never reuse a cached sudo session, -p '' no prompt
    const child = spawn('sudo', ['-S', '-k', '-p', '', '--', ...args], {
      stdio: ['pipe', 'ignore', 'pipe'],
      env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C', LANG: 'C' },
    })
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), SUDO_TIMEOUT_MS)
    child.stderr.on('data', (d: Buffer) => { if (stderr.length < 20_000) stderr += d.toString() })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stderr }) })
    child.stdin.on('error', () => { /* sudo exited before reading */ })
    child.stdin.end(`${password}\n`)
  })
}

export async function elevatedDelete(
  paths: string[], password: string,
): Promise<{ deleted: string[]; failed: { path: string; error: string }[] }> {
  if (process.getuid?.() === 0) throw new AppError('Nexus tourne déjà en root : la suppression normale suffit', 400)
  if (typeof password !== 'string' || !password || password.length > 1024 || /[\r\n\0]/.test(password)) {
    throw new AppError('Mot de passe invalide', 400)
  }

  const failed: { path: string; error: string }[] = []
  const targets: { input: string; real: string }[] = []
  for (const p of paths) {
    try { targets.push({ input: p, real: await checkTarget(p) }) }
    catch (err) { failed.push({ path: p, error: (err as Error).message }) }
  }
  if (!targets.length) return { deleted: [], failed }

  let res: SudoResult
  try {
    res = await runSudo(password, ['rm', '-rf', '--one-file-system', '--', ...targets.map((t) => t.real)])
  } catch (err) {
    throw new AppError(`sudo introuvable sur le serveur (${(err as Error).message})`, 500)
  }

  const err = res.stderr
  if (/incorrect password|Sorry, try again|no password was provided|Authentication failure/i.test(err)) {
    logger.warn('Forced deletion: wrong sudo password')
    throw new AppError('Mot de passe incorrect', 403, true, 'BAD_PASSWORD')
  }
  if (/not in the sudoers|not allowed to execute|may not run sudo|is not allowed to run sudo/i.test(err)) {
    throw new AppError('Ce compte n\'a pas le droit d\'utiliser sudo sur le serveur', 403)
  }
  if (/a terminal is required|askpass/i.test(err)) {
    throw new AppError('sudo exige un terminal sur ce serveur : utilise la commande indiquée à la place', 409)
  }

  const deleted: string[] = []
  for (const t of targets) {
    const gone = await fs.lstat(t.real).then(() => false, () => true)
    if (gone) deleted.push(t.input)
    else {
      const line = err.split('\n').find((l) => l.includes(t.real))
      failed.push({ path: t.input, error: line ? line.replace(/^rm:\s*/, '') : `Suppression impossible (sudo a répondu ${res.code})` })
    }
  }
  logger.info(`Forced deletion with sudo: ${deleted.length} deleted, ${failed.length} failed`)
  return { deleted, failed }
}
