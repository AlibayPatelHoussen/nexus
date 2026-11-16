import { Server, Socket } from 'socket.io'
import { SystemService } from './services/system'
import { logger } from './utils/logger'
import { attachTerminal } from './services/terminal'
import { setDownloadsNamespace } from './services/downloads'
import { setTransfersNamespace } from './services/transfers'
import { verifySession } from './middleware/auth'
import type { JwtPayload } from './middleware/auth'
import { checkSession } from './services/sessions'

interface SocketUser { userId: string; role: 'admin' | 'user'; sid?: string; sv?: number }

/** The account behind the socket's access token, if its session still holds (else null). */
async function authenticateSocket(socket: Socket): Promise<JwtPayload | null> {
  const token = socket.handshake.auth?.token
  if (typeof token !== 'string' || !token) return null
  return verifySession(token, 'access').catch(() => null)
}

type Guard = (socket: Socket, next: (err?: Error) => void) => void

/**
 * Signed-in accounts only; 'admin': admins only; 'media': accounts with the media (the storage,
 * the downloads). The socket keeps its user in socket.data.
 */
function guard(need: 'any' | 'admin' | 'media'): Guard {
  return (socket, next) => {
    void authenticateSocket(socket).then((user) => {
      if (!user) { next(new Error('unauthorized')); return }
      if (need === 'admin' && user.role !== 'admin') { next(new Error('forbidden')); return }
      if (need === 'media' && user.role !== 'admin' && user.canMedia === false) { next(new Error('forbidden')); return }
      socket.data = { userId: user.userId, role: user.role, sid: user.sid, sv: user.sv } satisfies SocketUser
      next()
    })
  }
}

/**
 * A socket stays open for hours: every 30 s its session is checked again, so a device
 * signed out (« Déconnecter », new password, account deleted or expired) loses it too.
 */
function watchSession(socket: Socket) {
  const claims = socket.data as SocketUser
  const timer = setInterval(() => {
    void checkSession(claims).catch(() => {
      logger.info(`Socket ${socket.nsp.name} ${socket.id}: session ended, disconnected`)
      socket.disconnect(true)
    })
  }, Number(process.env.SOCKET_SESSION_CHECK_MS) || 30_000)
  timer.unref()
  socket.on('disconnect', () => clearInterval(timer))
}

export function registerSocketHandlers(io: Server): void {

  // ─── Stats namespace ────────────────────────────
  const statsNs = io.of('/stats')
  statsNs.use(guard('media'))

  statsNs.on('connection', (socket) => {
    logger.info(`Stats socket connected: ${socket.id}`)
    watchSession(socket)
    // « user » accounts: the storage only
    const admin = (socket.data as SocketUser).role === 'admin'
    const send = () => SystemService.getStats()
      .then((stats) => socket.emit('stats', admin ? stats : SystemService.storageOnly(stats)))

    // Send stats every 3 seconds
    const interval = setInterval(() => {
      send().catch((err: unknown) => logger.error('Stats emit error', { err }))
    }, 3000)

    // Send immediately on connect
    send().catch(() => {})

    socket.on('disconnect', () => {
      clearInterval(interval)
      logger.info(`Stats socket disconnected: ${socket.id}`)
    })
  })

  // ─── Terminal namespace ──────────────────────────
  const termNs = io.of('/terminal')
  termNs.use(guard('admin'))

  termNs.on('connection', (socket) => {
    watchSession(socket)
    attachTerminal(socket, (socket.data as SocketUser).userId)
  })

  // ─── Downloads namespace (search results, progress) ─
  // Everyone signed in downloads; each account only hears about its own downloads, admins about all
  const dlNs = io.of('/downloads')
  dlNs.use(guard('media'))

  dlNs.on('connection', (socket) => {
    watchSession(socket)
    const { userId, role } = socket.data as SocketUser
    // Search results and the account's own downloads go to its room
    void socket.join(`user:${userId}`)
    if (role === 'admin') void socket.join('admins')
  })
  setDownloadsNamespace(dlNs)

  // ─── Transfers namespace (Aperçu, admins): a file sent from another device ─
  const trNs = io.of('/transfers')
  trNs.use(guard('admin'))
  trNs.on('connection', (socket) => {
    watchSession(socket)
    void socket.join(`user:${(socket.data as SocketUser).userId}`)
  })
  setTransfersNamespace(trNs)
}
