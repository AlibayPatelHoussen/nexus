import { spawn } from 'child_process'
import { AppError } from './errors'
import { logger } from './logger'

/**
 * Administrator mode for the file manager: when an operation is refused for
 * lack of rights and the Nexus account may use sudo WITHOUT a password
 * (NOPASSWD), it is done again with sudo — like the owner would in a shell.
 *
 * FILES_SUDO=auto (default) enables it when `sudo -n true` works,
 * FILES_SUDO=off disables it (then the chown hint / password prompt is shown).
 */

const isRoot = process.getuid?.() === 0
let cache: { ok: boolean; at: number } | null = null

export interface SudoResult { code: number | null; stdout: Buffer; stderr: string }

/** Runs `sudo -n -- <args>` (never prompts), optional stdin. */
export function sudo(args: string[], input?: string | Buffer, timeoutMs = 120_000): Promise<SudoResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', '--', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' },
    })
    const out: Buffer[] = []
    let size = 0
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (d: Buffer) => { size += d.length; if (size <= 64 * 1024 * 1024) out.push(d) })
    child.stderr.on('data', (d: Buffer) => { if (stderr.length < 20_000) stderr += d.toString() })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(out), stderr }) })
    child.stdin.on('error', () => { /* exited before reading */ })
    child.stdin.end(input ?? '')
  })
}

/** True when the administrator mode is available (cached 60 s). */
export async function canSudo(): Promise<boolean> {
  if (isRoot || (process.env.FILES_SUDO || 'auto') === 'off') return false
  if (cache && Date.now() - cache.at < 60_000) return cache.ok
  const ok = await sudo(['true'], '', 10_000).then((r) => r.code === 0, () => false)
  if (!cache || cache.ok !== ok) logger.info(`File manager administrator mode (sudo without password): ${ok ? 'on' : 'off'}`)
  cache = { ok, at: Date.now() }
  return ok
}

/** Runs a command with sudo and throws a clear error if it fails. */
export async function sudoRun(args: string[], input?: string | Buffer): Promise<Buffer> {
  let res: SudoResult
  try { res = await sudo(args, input) }
  catch (err) { throw new AppError(`sudo introuvable (${(err as Error).message})`, 500) }
  if (res.code !== 0) {
    const line = res.stderr.split('\n').map((l) => l.trim()).find(Boolean) || `code ${res.code}`
    throw new AppError(`Échec (mode administrateur) : ${line.replace(/^(\S+:\s*)+/, '')}`, 409)
  }
  return res.stdout
}

export function isPermissionError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code
  return code === 'EACCES' || code === 'EPERM'
}

/** `uid:gid` of the Nexus account: owner given to what it creates with sudo. */
export const owner = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`

/**
 * Runs `op`; if it fails for lack of rights and sudo is available, runs
 * `elevated` instead. Other errors (and no sudo) are rethrown unchanged.
 */
export async function withSudo<T>(op: () => Promise<T>, elevated: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (err) {
    if (!isPermissionError(err) || !(await canSudo())) throw err
    return elevated()
  }
}
