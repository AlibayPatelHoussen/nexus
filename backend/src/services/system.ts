import { clampLines } from './services'
import si from 'systeminformation'
import { query } from '../config/database'
import { logger } from '../utils/logger'

export interface SystemStats {
  cpu: {
    usage: number
    cores: number
    model: string
    speed: number
  }
  memory: {
    total: number
    used: number
    free: number
    usedPercent: number
  }
  disk: {
    total: number
    used: number
    free: number
    usedPercent: number
  }
  mediaStorage: {
    films:  number
    series: number
    animes: number
    manga:  number
  }
  temperature: number | null
  uptime: number
  network: {
    status: 'online' | 'offline'
    ip: string
    interface: string
    rx: number
    tx: number
  }
  os: {
    platform: string
    distro: string
    release: string
    hostname: string
    arch: string
  }
}

// Cache for media storage — refreshed from DB every 5 min
let _mediaCache = { films: 0, series: 0, animes: 0, manga: 0 }
let _mediaCacheAt = 0

async function refreshMediaStorage(): Promise<void> {
  try {
    // Films: file_size on media_items directly
    // Series/Animes: file_size on episodes table (media_items.file_size is NULL)
    const result = await query<{ type: string; total: string }>(`
      WITH direct AS (
        SELECT type, COALESCE(SUM(file_size), 0) AS total
        FROM media_items
        GROUP BY type
      ),
      from_episodes AS (
        SELECT mi.type, COALESCE(SUM(e.file_size), 0) AS total
        FROM episodes e
        JOIN media_items mi ON mi.id = e.media_item_id
        GROUP BY mi.type
      )
      SELECT d.type, (d.total + COALESCE(ep.total, 0)) AS total
      FROM direct d
      LEFT JOIN from_episodes ep ON ep.type = d.type
    `)
    const map: Record<string, number> = {}
    for (const row of result.rows) map[row.type] = parseInt(row.total, 10) || 0
    _mediaCache = {
      films:  map['film']    || 0,
      series: map['serie']   || 0,
      animes: map['anime']   || 0,
      manga:  (map['manga']  || 0) + (map['webtoon'] || 0),
    }
    _mediaCacheAt = Date.now()
    logger.info(`Media storage: ${JSON.stringify(_mediaCache)}`)
  } catch (err) {
    logger.error(`refreshMediaStorage failed: ${err}`)
    _mediaCacheAt = Date.now() - 4 * 60_000
  }
}


export class SystemService {
  static async getStats(): Promise<SystemStats> {
    // Trigger background refresh of media sizes if cache is older than 5 min
    if (Date.now() - _mediaCacheAt > 5 * 60_000) {
      refreshMediaStorage().catch(() => {})
    }

    const [cpu, cpuInfo, mem, fsSize, temp, networkInterfaces, osInfo, time, netStats] =
      await Promise.all([
        si.currentLoad(),
        si.cpu(),
        si.mem(),
        si.fsSize(),
        si.cpuTemperature(),
        si.networkInterfaces(),
        si.osInfo(),
        si.time(),
        si.networkStats(),
      ])

    // Main disk (filter loop devices)
    const mainDisk = fsSize.find(d => d.mount === '/' || d.mount === 'C:') || fsSize[0]

    // Network interface
    const activeIface = Array.isArray(networkInterfaces)
      ? networkInterfaces.find(n => !n.internal && n.ip4 !== '')
      : null

    const netStat = netStats[0]
    // Memory really used by programs: Linux fills free RAM with the disk cache,
    // which is given back at once when needed (what Activity Monitor / htop show)
    const memUsed = mem.available > 0 ? mem.total - mem.available : mem.active || mem.used
    // Free space you can actually write (without the blocks reserved for root)
    const diskFree = mainDisk?.available ?? Math.max(0, (mainDisk?.size || 0) - (mainDisk?.used || 0))

    return {
      cpu: {
        usage:  Math.round(cpu.currentLoad),
        cores:  cpu.cpus.length,
        model:  cpuInfo.brand,
        speed:  cpuInfo.speed,
      },
      memory: {
        total:       mem.total,
        used:        memUsed,
        free:        mem.total - memUsed,
        usedPercent: Math.round((memUsed / mem.total) * 100),
      },
      disk: {
        total:       mainDisk?.size || 0,
        used:        mainDisk?.used || 0,
        free:        diskFree,
        usedPercent: Math.round(mainDisk?.use || 0),
      },
      mediaStorage: { ..._mediaCache },
      temperature: temp.main ?? null,
      uptime:      time.uptime,
      network: {
        status:    activeIface ? 'online' : 'offline',
        ip:        activeIface?.ip4 || '',
        interface: activeIface?.iface || '',
        rx:        netStat?.rx_bytes || 0,
        tx:        netStat?.tx_bytes || 0,
      },
      os: {
        platform: osInfo.platform,
        distro:   osInfo.distro,
        release:  osInfo.release,
        hostname: osInfo.hostname,
        arch:     osInfo.arch,
      },
    }
  }

  static async getLogs(lines = 100): Promise<string[]> {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const execFileAsync = promisify(execFile)
    const n = String(clampLines(lines, 100))

    try {
      const { stdout } = await execFileAsync('journalctl', ['-n', n, '--no-pager', '-o', 'short-iso'])
      return stdout.split('\n').filter(Boolean)
    } catch {
      try {
        const { stdout } = await execFileAsync('tail', ['-n', n, '/var/log/syslog'])
        return stdout.split('\n').filter(Boolean)
      } catch {
        return ['No logs available']
      }
    }
  }
}
