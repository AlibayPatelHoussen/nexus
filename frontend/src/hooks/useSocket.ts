import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuthStore } from '@/stores/authStore'
import { getFreshAccessToken } from '@/services/api'
import type { SystemStats } from '@/types'

// Called on every (re)connection, so an expired access token is refreshed first
const socketAuth = (cb: (data: object) => void) => {
  getFreshAccessToken()
    .then((token) => cb({ token }))
    .catch(() => cb({ token: '' }))
}

export function useSystemStats() {
  const [stats, setStats]     = useState<SystemStats | null>(null)
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const userId    = useAuthStore((s) => s.user?.id)

  useEffect(() => {
    if (!userId) return

    const socket = io('/stats', {
      auth: socketAuth,
      transports: ['websocket'],
    })

    socketRef.current = socket
    let retry: ReturnType<typeof setTimeout> | null = null

    socket.on('connect',    () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('stats',      (data: SystemStats) => setStats(data))
    // Auth rejections are not retried automatically by socket.io
    socket.on('connect_error', () => {
      setConnected(false)
      if (!socket.active) retry = setTimeout(() => socket.connect(), 5000)
    })

    return () => {
      if (retry) clearTimeout(retry)
      socket.disconnect()
    }
  }, [userId])

  return { stats, connected }
}

export interface TerminalInfo { sessionId: string; resumed: boolean; user: string; host: string; shell: string }

export interface TerminalHandlers {
  /** Session id to resume (read on every (re)connection) */
  sessionId: () => string
  /** Current terminal size, sent when the shell starts / is resumed */
  size:      () => { cols: number; rows: number }
  onReady:   (info: TerminalInfo) => void
  onOutput:  (data: string) => void
  /** Recent output of a resumed session: the screen is rebuilt from it */
  onReplay:  (data: string) => void
  onExit:    (code: number) => void
  onStatus:  (status: 'connecting' | 'connected' | 'disconnected' | 'detached') => void
}

/**
 * Socket of the server terminal. The shell lives on the server: leaving the
 * page or losing the network only detaches it, the same session id resumes it.
 */
export function useTerminalSocket() {
  const socketRef = useRef<Socket | null>(null)

  function connect(h: TerminalHandlers) {
    if (socketRef.current) return
    h.onStatus('connecting')
    const socket = io('/terminal', {
      auth: (cb) => {
        getFreshAccessToken()
          .catch(() => '')
          .then((token) => cb({ token, sessionId: h.sessionId(), ...h.size() }))
      },
      transports: ['websocket'],
    })
    socketRef.current = socket
    let detached = false
    socket.on('connect',    () => h.onStatus('connected'))
    socket.on('disconnect', () => h.onStatus(detached ? 'detached' : 'disconnected'))
    socket.on('connect_error', () => {
      h.onStatus('disconnected')
      // Auth rejections are not retried automatically by socket.io
      setTimeout(() => { if (socketRef.current === socket && !socket.active) socket.connect() }, 3000)
    })
    socket.on('ready',    h.onReady)
    socket.on('output',   h.onOutput)
    socket.on('replay',   h.onReplay)
    socket.on('exit',     h.onExit)
    socket.on('detached', () => { detached = true })
  }

  /** Reconnect (e.g. with a new session id after "Nouvelle session") */
  function reconnect() {
    const s = socketRef.current
    if (!s) return
    s.disconnect()
    s.connect()
  }

  function send(input: string)              { socketRef.current?.emit('input', input) }
  function resize(cols: number, rows: number) { socketRef.current?.emit('resize', { cols, rows }) }
  function closeSession()                   { socketRef.current?.emit('close-session') }

  function disconnect() {
    socketRef.current?.disconnect()
    socketRef.current = null
  }

  return { connect, reconnect, send, resize, closeSession, disconnect }
}
