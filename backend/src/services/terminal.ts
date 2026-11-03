import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn, type IPty } from 'node-pty'
import type { Socket } from 'socket.io'
import { logger } from '../utils/logger'

/**
 * Server terminal, like Cockpit's: a real login shell of the account Nexus
 * runs as, with a clean environment (Nexus' secrets are NOT inherited).
 *
 * Sessions survive the browser: leaving the page, a network cut or a phone
 * going to sleep only detaches it; reconnecting with the same session id
 * re-attaches and replays the recent output. A detached session is closed
 * after TERMINAL_IDLE_MINUTES (default 60).
 */

interface Session {
  id:       string
  userId:   string
  pty:      IPty
  chunks:   string[]
  size:     number
  socket:   Socket | null
  idle:     NodeJS.Timeout | null
}

const sessions = new Map<string, Session>()
const MAX_BUFFER   = 256 * 1024
const MAX_PER_USER = 5
const idleMs = () => Math.max(1, Number(process.env.TERMINAL_IDLE_MINUTES) || 60) * 60_000

/** Login shell of the account (falls back to bash for nologin / false). */
function loginShell(): string {
  const shell = os.userInfo().shell
  if (shell && fs.existsSync(shell) && !/nologin|false$/.test(shell)) return shell
  return fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh'
}

/** Clean environment, as after logging in over SSH / Cockpit. */
export function loginEnv(): Record<string, string> {
  const u = os.userInfo()
  const env: Record<string, string> = {
    HOME:      u.homedir,
    USER:      u.username,
    LOGNAME:   u.username,
    SHELL:     loginShell(),
    PATH:      '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin',
    LANG:      process.env.LANG && process.env.LANG !== 'C' ? process.env.LANG : 'C.UTF-8',
    TERM:      'xterm-256color',
    COLORTERM: 'truecolor',
  }
  if (process.env.TZ) env.TZ = process.env.TZ
  return env
}

function clampSize(v: unknown, def: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n > 1 && n <= 1000 ? n : def
}

function kill(s: Session): void {
  if (s.idle) clearTimeout(s.idle)
  sessions.delete(s.id)
  try { s.pty.kill() } catch { /* already gone */ }
}

function create(id: string, userId: string, cols: number, rows: number): Session {
  // Keep a few sessions per user: drop the oldest detached ones
  const mine = [...sessions.values()].filter((s) => s.userId === userId)
  for (const old of mine.filter((s) => !s.socket).slice(0, Math.max(0, mine.length - MAX_PER_USER + 1))) kill(old)

  const env = loginEnv()
  const pty = spawn(env.SHELL, ['-l'], { name: 'xterm-256color', cols, rows, cwd: env.HOME, env })
  const s: Session = { id, userId, pty, chunks: [], size: 0, socket: null, idle: null }

  pty.onData((data) => {
    s.chunks.push(data); s.size += data.length
    while (s.size > MAX_BUFFER && s.chunks.length > 1) s.size -= s.chunks.shift()!.length
    s.socket?.emit('output', data)
  })
  pty.onExit(({ exitCode }) => {
    if (s.idle) clearTimeout(s.idle)
    sessions.delete(s.id)
    s.socket?.emit('exit', exitCode)
    logger.info(`Terminal session ${id} ended (${exitCode})`)
  })
  sessions.set(id, s)
  logger.info(`Terminal session ${id} started (${env.SHELL} as ${env.USER})`)
  return s
}

/** Handles one terminal socket (already authenticated as an admin). */
export function attachTerminal(socket: Socket, userId: string): void {
  const auth = socket.handshake.auth ?? {}
  const cols = clampSize(auth.cols, 80)
  const rows = clampSize(auth.rows, 24)
  let id = typeof auth.sessionId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(auth.sessionId) ? auth.sessionId : ''

  let s = id ? sessions.get(id) : undefined
  if (s && s.userId !== userId) { s = undefined; id = '' }
  if (!id) id = Math.random().toString(36).slice(2) + Date.now().toString(36)

  const resumed = !!s
  if (s) {
    if (s.idle) { clearTimeout(s.idle); s.idle = null }
    // Opened in another tab/device: that one is detached
    if (s.socket && s.socket !== socket) { s.socket.emit('detached'); s.socket.disconnect(true) }
  } else {
    try {
      s = create(id, userId, cols, rows)
    } catch (err) {
      logger.error('Terminal spawn failed', { err })
      socket.emit('output', `\r\n\x1b[31mImpossible de démarrer le shell : ${(err as Error).message}\x1b[0m\r\n`)
      socket.disconnect(true)
      return
    }
  }
  const session = s
  session.socket = socket

  socket.emit('ready', { sessionId: id, resumed, user: os.userInfo().username, host: os.hostname(), shell: path.basename(loginShell()) })
  if (resumed) {
    socket.emit('replay', session.chunks.join(''))
    // Size may have changed while away; full-screen apps redraw on SIGWINCH
    try { session.pty.resize(cols, rows) } catch { /* exited */ }
  }

  socket.on('input', (data: unknown) => { if (typeof data === 'string' && sessions.has(id)) session.pty.write(data) })
  socket.on('resize', (size: { cols?: unknown; rows?: unknown } | undefined) => {
    const c = clampSize(size?.cols, 0); const r = clampSize(size?.rows, 0)
    if (c && r && sessions.has(id)) { try { session.pty.resize(c, r) } catch { /* exited */ } }
  })
  // "Réinitialiser": end this shell (the client then starts a new one)
  socket.on('close-session', () => { if (sessions.get(id) === session) kill(session); socket.emit('exit', 0) })

  socket.on('disconnect', () => {
    if (session.socket !== socket) return
    session.socket = null
    if (!sessions.has(id)) return
    session.idle = setTimeout(() => {
      logger.info(`Terminal session ${id} closed after inactivity`)
      kill(session)
    }, idleMs())
  })
}

/** For tests / shutdown. */
export function closeAllTerminals(): void {
  for (const s of [...sessions.values()]) kill(s)
}
