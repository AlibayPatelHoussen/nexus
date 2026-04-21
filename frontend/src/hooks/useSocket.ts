import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuthStore } from '@/stores/authStore'
import type { SystemStats } from '@/types'

export function useSystemStats() {
  const [stats, setStats]     = useState<SystemStats | null>(null)
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const token     = useAuthStore((s) => s.accessToken)

  useEffect(() => {
    if (!token) return

    const socket = io('/stats', {
      auth: { token },
      transports: ['websocket'],
    })

    socketRef.current = socket

    socket.on('connect',    () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('stats',      (data: SystemStats) => setStats(data))

    return () => {
      socket.disconnect()
    }
  }, [token])

  return { stats, connected }
}

export function useTerminalSocket() {
  const socketRef = useRef<Socket | null>(null)
  const token     = useAuthStore((s) => s.accessToken)

  function connect(
    onOutput: (data: string) => void,
    onExit:   (code: number) => void,
  ) {
    if (socketRef.current?.connected) return

    const socket = io('/terminal', {
      auth: { token },
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
