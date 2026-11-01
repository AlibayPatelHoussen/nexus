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

export function useTerminalSocket() {
  const socketRef = useRef<Socket | null>(null)

  function connect(
    onOutput: (data: string) => void,
    onExit:   (code: number) => void,
  ) {
    if (socketRef.current?.connected) return

    const socket = io('/terminal', {
      auth: socketAuth,
      transports: ['websocket'],
    })

    socketRef.current = socket
    socket.on('output', onOutput)
    socket.on('exit',   onExit)
  }

  function send(input: string) {
    socketRef.current?.emit('input', input)
  }

  function resize(cols: number, rows: number) {
    socketRef.current?.emit('resize', { cols, rows })
  }

  function disconnect() {
    socketRef.current?.disconnect()
    socketRef.current = null
  }

  return { connect, send, resize, disconnect }
}
