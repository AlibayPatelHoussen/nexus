import { Server, Socket } from 'socket.io'
import { spawn } from 'node-pty'
import jwt from 'jsonwebtoken'
import { SystemService } from './services/system'
import { logger } from './utils/logger'
import type { JwtPayload } from './middleware/auth'

function authenticateSocket(socket: Socket): JwtPayload | null {
  try {
    const token = socket.handshake.auth.token as string
    if (!token) return null
    return jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
  } catch {
    return null
  }
}

export function registerSocketHandlers(io: Server): void {

  // ─── Stats namespace ────────────────────────────
  const statsNs = io.of('/stats')

  statsNs.use((socket, next) => {
    const user = authenticateSocket(socket)
    if (!user) { socket.disconnect(); return }
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
    if (!user || user.role !== 'admin') { socket.disconnect(); return }
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

    socket.on('input', (data: string) => shell.write(data))

    socket.on('resize', ({ cols, rows }: { cols: number; rows: number }) => {
      shell.resize(cols, rows)
    })

    socket.on('disconnect', () => {
      shell.kill()
      logger.info(`Terminal socket disconnected: ${socket.id}`)
    })
  })
}
