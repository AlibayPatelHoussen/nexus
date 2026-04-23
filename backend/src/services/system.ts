import si from 'systeminformation'

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

// Cache for directory sizes — expensive to compute with du
let _mediaCache = { films: 0, series: 0, animes: 0, manga: 0 }
let _mediaCacheAt = 0
let _mediaComputing = false

async function refreshMediaStorage(): Promise<void> {
  if (_mediaComputing) return
  _mediaComputing = true
  try {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    const getSize = async (p: string): Promise<number> => {
      if (!p) return 0
      try {
        const { stdout } = await execAsync(`du -sb "${p}" 2>/dev/null | awk '{print $1}'`)
        return parseInt(stdout.trim(), 10) || 0
      } catch { return 0 }
    }

    const [films, series, animes, manga] = await Promise.all([
      getSize(process.env.FILMS_PATH  || ''),
      getSize(process.env.SERIES_PATH || ''),
      getSize(process.env.ANIMES_PATH || ''),
      getSize(process.env.MANGA_PATH  || ''),
    ])
    _mediaCache = { films, series, animes, manga }
    _mediaCacheAt = Date.now()
  } finally {
    _mediaComputing = false
  }
}

export class SystemService {
  static async getStats(): Promise<SystemStats> {
    // Trigger background refresh of media sizes if cache is older than 5 min
    if (Date.now() - _mediaCacheAt > 5 * 60_000) {
      refreshMediaStorage().catch(() => {})
    }

    const [cpu, mem, fsSize, temp, networkInterfaces, osInfo, time, netStats] =
      await Promise.all([
        si.currentLoad(),
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

    return {
      cpu: {
        usage:  Math.round(cpu.currentLoad),
        cores:  cpu.cpus.length,
        model:  (await si.cpu()).brand,
        speed:  (await si.cpu()).speed,
      },
      memory: {
        total:       mem.total,
        used:        mem.used,
        free:        mem.free,
        usedPercent: Math.round((mem.used / mem.total) * 100),
      },
      disk: {
        total:       mainDisk?.size || 0,
        used:        mainDisk?.used || 0,
        free:        (mainDisk?.size || 0) - (mainDisk?.used || 0),
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
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    try {
      const { stdout } = await execAsync(
        `journalctl -n ${lines} --no-pager -o short-iso 2>/dev/null || tail -n ${lines} /var/log/syslog 2>/dev/null || echo "No logs available"`,
      )
      return stdout.split('\n').filter(Boolean)
    } catch {
      return ['Unable to fetch logs']
    }
  }

  static async runCommand(cmd: string): Promise<{ stdout: string; stderr: string }> {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)
    return execAsync(cmd)
  }
}
