import { Server, Socket } from 'socket.io'
import { SystemService } from './services/system'
import { logger } from './utils/logger'
import { attachTerminal } from './services/terminal'
import { setDownloadsNamespace } from './services/downloads'
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
    socket.data = { userId: user.userId }
    next()
  })

  termNs.on('connection', (socket) => {
    attachTerminal(socket, (socket.data as { userId: string }).userId)
  })

  // ─── Downloads namespace (search results, progress) ─
  const dlNs = io.of('/downloads')

  dlNs.use((socket, next) => {
    const user = authenticateSocket(socket)
    if (!user) { next(new Error('unauthorized')); return }
    if (user.role !== 'admin') { next(new Error('forbidden')); return }
    socket.data = { userId: user.userId }
    next()
  })

  dlNs.on('connection', (socket) => {
    // Search results only go to the user who searched
    void socket.join(`user:${(socket.data as { userId: string }).userId}`)
  })
  setDownloadsNamespace(dlNs)
}
