import { useEffect, useRef, useState } from 'react'
import type { SystemStats } from '@/types'

export interface StatsHistory {
  cpu:  number[]     // %
  mem:  number[]     // %
  down: number[]     // bytes / s
  up:   number[]     // bytes / s
}

const EMPTY: StatsHistory = { cpu: [], mem: [], down: [], up: [] }

/**
 * Keeps the last `size` samples of the live stats (the server sends one
 * every 3 s, so 60 samples = 3 minutes). Network throughput is derived from
 * the byte counters between two samples.
 */
export function useStatsHistory(stats: SystemStats | null, size = 60): StatsHistory {
  const [history, setHistory] = useState<StatsHistory>(EMPTY)
  const prev = useRef<{ rx: number; tx: number; t: number } | null>(null)

  useEffect(() => {
    if (!stats) return
    const now = Date.now()
    const p = prev.current
    let down = 0, up = 0
    if (p && now > p.t && stats.network.rx >= p.rx && stats.network.tx >= p.tx) {
      const dt = (now - p.t) / 1000
      down = (stats.network.rx - p.rx) / dt
      up   = (stats.network.tx - p.tx) / dt
    }
    const first = !p
    prev.current = { rx: stats.network.rx, tx: stats.network.tx, t: now }
    const push = (a: number[], v: number) => [...a, v].slice(-size)
    setHistory((h) => ({
      cpu:  push(h.cpu, stats.cpu.usage),
      mem:  push(h.mem, stats.memory.usedPercent),
      // No rate for the very first sample (no previous counter)
      down: first ? h.down : push(h.down, down),
      up:   first ? h.up : push(h.up, up),
    }))
  }, [stats, size])

  return history
}
