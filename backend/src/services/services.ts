import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface ServiceInfo {
  name: string
  displayName: string
  description: string
  status: 'active' | 'inactive' | 'failed' | 'unknown'
  url?: string
  icon: string
  color: string
}

// Known services on the server
const KNOWN_SERVICES: Omit<ServiceInfo, 'status'>[] = [
  {
    name:        'cloudflared',
    displayName: 'Cloudflare Tunnel',
    description: 'cloudflared.service',
    url:         'https://houssen-serveur.com',
    icon:        'globe',
    color:       'blue',
  },
  {
    name:        'jellyfin',
    displayName: 'Jellyfin',
    description: 'jellyfin.service',
    url:         'https://jellyfin.houssen-serveur.com',
    icon:        'play-circle',
    color:       'orange',
  },
  {
    name:        'filebrowser',
    displayName: 'Filebrowser',
    description: 'filebrowser.service',
    url:         'https://files.houssen-serveur.com',
    icon:        'folder-open',
    color:       'purple',
  },
  {
    name:        'cockpit',
    displayName: 'Cockpit',
    description: 'cockpit.socket',
    url:         'https://cockpit.houssen-serveur.com',
    icon:        'monitor-check',
    color:       'teal',
  },
  {
    name:        'wifi',
    displayName: 'Wi-Fi',
    description: 'wifi.service',
    icon:        'wifi',
    color:       'green',
  },
  {
    name:        'postgresql',
    displayName: 'PostgreSQL',
    description: 'postgresql.service',
    icon:        'database',
    color:       'blue',
  },
]

async function getServiceStatus(name: string): Promise<ServiceInfo['status']> {
  try {
    const { stdout } = await execAsync(
      `systemctl is-active ${name} 2>/dev/null`,
    )
    const state = stdout.trim()
    if (state === 'active')   return 'active'
    if (state === 'inactive') return 'inactive'
    if (state === 'failed')   return 'failed'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

export class ServicesService {
  static async getAll(): Promise<ServiceInfo[]> {
    const results = await Promise.all(
      KNOWN_SERVICES.map(async (svc) => ({
        ...svc,
        status: await getServiceStatus(svc.name),
      })),
    )
    return results
  }

  static async toggle(name: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
    const allowed = KNOWN_SERVICES.map(s => s.name)
    if (!allowed.includes(name)) {
      throw new Error(`Service ${name} not allowed`)
    }
    await execAsync(`sudo systemctl ${action} ${name}`)
  }

  static async getLogs(name: string, lines = 50): Promise<string[]> {
    const allowed = KNOWN_SERVICES.map(s => s.name)
    if (!allowed.includes(name)) throw new Error('Service not allowed')

    try {
      const { stdout } = await execAsync(
        `journalctl -u ${name} -n ${lines} --no-pager -o short-iso 2>/dev/null`,
      )
      return stdout.split('\n').filter(Boolean)
    } catch {
      return ['Unable to fetch logs']
    }
  }
}
