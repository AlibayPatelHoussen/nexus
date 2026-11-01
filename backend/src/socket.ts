import { Server, Socket } from 'socket.io'
import { spawn } from 'node-pty'
import { SystemService } from './services/system'
import { logger } from './utils/logger'
import { verifyToken } from './middleware/auth'
import type { JwtPayload } from './middleware/auth'

function authenticateSocket(socket: Socket): JwtPayload | null {
  const token = socket.handshake.auth?.token
  return typeof token === 'string' && token ? verifyToken(token, 'access') : null
}

export function registerSocketHandlers(io: Server): void {

  // ─── Stats namespace ────────────────────────────
  const statsNs = io.of('/stats')

  statsNs.use((socket, next) => {
    const user = authenticateSocket(socket)
    if (!user) { next(new Error('unauthorized')); return }
    next()
  })

  statsNs.on('connection', (socket) => {
    logger.info(`Stats socket connected: ${socket.id}`)

    // Send stats every 3 seconds
    const interval = setInterval(() => {
      SystemService.getStats()
        .then(stats => socket.emit('stats', stats))
        .catch((err: unknown) => logger.error('Stats emit error', { err }))
    }, 3000)

    // Send immediately on connect
    SystemService.getStats().then(stats => socket.emit('stats', stats)).catch(() => {})

    socket.on('disconnect', () => {
      clearInterval(interval)
      logger.info(`Stats socket disconnected: ${socket.id}`)
    })
  })

  // ─── Terminal namespace ──────────────────────────
  const termNs = io.of('/terminal')

  termNs.use((socket, next) => {
    const user = authenticateSocket(socket)
    if (!user) { next(new Error('unauthorized')); return }
    if (user.role !== 'admin') { next(new Error('forbidden')); return }
    next()
  })

  termNs.on('connection', (socket) => {
    logger.info(`Terminal socket connected: ${socket.id}`)

    const isWindows = process.platform === 'win32'
    const shell = spawn(isWindows ? 'powershell.exe' : 'bash', [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || process.env.USERPROFILE || '/',
      env: process.env as Record<string, string>,
    })

    shell.onData((data) => socket.emit('output', data))

    shell.onExit(({ exitCode }) => {
      socket.emit('exit', exitCode)
      socket.disconnect()
    })

    socket.on('input', (data: unknown) => { if (typeof data === 'string') shell.write(data) })

    socket.on('resize', (size: { cols?: unknown; rows?: unknown } | undefined) => {
      const cols = Number(size?.cols)
      const rows = Number(size?.rows)
      if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0 && cols <= 1000 && rows <= 1000) {
        shell.resize(cols, rows)
      }
    })

    socket.on('disconnect', () => {
      shell.kill()
      logger.info(`Terminal socket disconnected: ${socket.id}`)
    })
  })
}
