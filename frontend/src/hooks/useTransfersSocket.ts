import { useEffect, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useQueryClient } from '@tanstack/react-query'
import { getFreshAccessToken } from '@/services/api'
import type { Transfer } from '@/services/transfersService'

export interface AddedEvent { items: Transfer[]; from: string | null; client: string | null }
export interface RemovedEvent { ids: string[]; client?: string | null }

/**
 * One shared connection to /transfers (admins): a file sent from another device appears at
 * once in Aperçu (the « transfers » cache is updated from the events).
 */
let socket: Socket | null = null
let users = 0

function connect(): Socket {
  if (socket) return socket
  socket = io('/transfers', {
    auth: (cb) => { getFreshAccessToken().then((token) => cb({ token })).catch(() => cb({ token: '' })) },
    transports: ['websocket'],
  })
  socket.on('connect_error', () => {
    if (socket && !socket.active) setTimeout(() => socket?.connect(), 5000)
  })
  return socket
}

export function useTransfersSocket(enabled = true): Socket | null {
  const qc = useQueryClient()
  const [s, setS] = useState<Socket | null>(null)

  useEffect(() => {
    if (!enabled) return
    const sock = connect()
    users++
    setS(sock)
    const onAdded = ({ items }: AddedEvent) => {
      qc.setQueryData<Transfer[]>(['transfers'], (list) => {
        if (!list) return list
        const known = new Set(list.map((t) => t.id))
        return [...items.filter((t) => !known.has(t.id)), ...list]
      })
    }
    const onRemoved = ({ ids }: RemovedEvent) => {
      const gone = new Set(ids)
      qc.setQueryData<Transfer[]>(['transfers'], (list) => list?.filter((t) => !gone.has(t.id)))
    }
    // Back after a cut: what arrived meanwhile
    const onConnect = () => { void qc.invalidateQueries({ queryKey: ['transfers'] }) }
    sock.on('transfer:added', onAdded)
    sock.on('transfer:removed', onRemoved)
    sock.io.on('reconnect', onConnect)
    return () => {
      sock.off('transfer:added', onAdded)
      sock.off('transfer:removed', onRemoved)
      sock.io.off('reconnect', onConnect)
      users--
      if (users === 0) { sock.disconnect(); socket = null }
      setS(null)
    }
  }, [qc, enabled])

  return s
}
