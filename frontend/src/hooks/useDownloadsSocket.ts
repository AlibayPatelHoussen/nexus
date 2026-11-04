import { useEffect, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useQueryClient } from '@tanstack/react-query'
import { getFreshAccessToken } from '@/services/api'
import type { Download, DownloadProgress } from '@/services/downloadsService'

/**
 * One shared connection to the /downloads namespace (search results, live
 * progress). The queue cache (react-query "downloads") is kept up to date
 * from the events, so every screen showing it updates by itself.
 */
let socket: Socket | null = null
let users = 0

function connect(): Socket {
  if (socket) return socket
  socket = io('/downloads', {
    auth: (cb) => { getFreshAccessToken().then((token) => cb({ token })).catch(() => cb({ token: '' })) },
    transports: ['websocket'],
  })
  socket.on('connect_error', () => {
    if (socket && !socket.active) setTimeout(() => socket?.connect(), 5000)
  })
  return socket
}

export function useDownloadsSocket(): Socket | null {
  const qc = useQueryClient()
  const [s, setS] = useState<Socket | null>(null)

  useEffect(() => {
    const sock = connect()
    users++
    setS(sock)
    const onStatus = (row: Download) => {
      qc.setQueryData<Download[]>(['downloads'], (list) => {
        if (!list) return list
        const i = list.findIndex((d) => d.id === row.id)
        if (i < 0) return [row, ...list]
        const next = list.slice(); next[i] = row; return next
      })
    }
    const onProgress = ({ id, progress }: { id: string; progress: DownloadProgress }) => {
      qc.setQueryData<Download[]>(['downloads'], (list) => list?.map((d) => (d.id === id ? { ...d, progress } : d)))
    }
    const onRemoved = ({ id }: { id: string }) => {
      qc.setQueryData<Download[]>(['downloads'], (list) => list?.filter((d) => d.id !== id))
    }
    sock.on('download:status', onStatus)
    sock.on('download:progress', onProgress)
    sock.on('download:removed', onRemoved)
    return () => {
      sock.off('download:status', onStatus)
      sock.off('download:progress', onProgress)
      sock.off('download:removed', onRemoved)
      users--
      if (users === 0) { sock.disconnect(); socket = null }
    }
  }, [qc])

  return s
}
