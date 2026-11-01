import { NotFoundError } from '../utils/errors'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** Clamp a user-supplied line count to 1..1000. */
export function clampLines(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), 1), 1000)
}

// Public base domain for service links, e.g. "example.com" gives
// https://jellyfin.example.com. Leave empty to hide the links.
const DOMAIN = (process.env.SERVICES_DOMAIN || '').trim()
const link = (sub?: string): string | undefined =>
  DOMAIN ? `https://${sub ? `${sub}.` : ''}${DOMAIN}` : undefined

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
    url:         link(),
    icon:        'globe',
    color:       'blue',
  },
  {
    name:        'jellyfin',
    displayName: 'Jellyfin',
    description: 'jellyfin.service',
    url:         link('jellyfin'),
    icon:        'play-circle',
    color:       'orange',
  },
  {
    name:        'filebrowser',
    displayName: 'Filebrowser',
    description: 'filebrowser.service',
    url:         link('files'),
    icon:        'folder-open',
    color:       'purple',
  },
  {
    name:        'cockpit',
    displayName: 'Cockpit',
    description: 'cockpit.socket',
    url:         link('cockpit'),
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
    const state = await execFileAsync('systemctl', ['is-active', name])
      .then(({ stdout }) => stdout.trim())
      // `is-active` exits non-zero for inactive/failed units but still prints the state
      .catch((err: { stdout?: string }) => (err.stdout || '').trim())
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
      throw new NotFoundError('Service')
    }
    await execFileAsync('sudo', ['-n', 'systemctl', action, name])
  }

  static async getLogs(name: string, lines = 50): Promise<string[]> {
    const allowed = KNOWN_SERVICES.map(s => s.name)
    if (!allowed.includes(name)) throw new NotFoundError('Service')
    const n = clampLines(lines, 50)

    try {
      const { stdout } = await execFileAsync(
        'journalctl', ['-u', name, '-n', String(n), '--no-pager', '-o', 'short-iso'],
      )
      return stdout.split('\n').filter(Boolean)
    } catch {
      return ['Unable to fetch logs']
    }
  }
}
