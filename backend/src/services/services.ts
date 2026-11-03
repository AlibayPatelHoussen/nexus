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

export type ServiceStatus =
  | 'active'        // running
  | 'waiting'       // started on demand: its socket / timer / path is armed (Cockpit idle)
  | 'activating' | 'deactivating'
  | 'inactive' | 'failed'
  | 'missing'       // not installed on this server
  | 'unknown'

export interface ServiceInfo {
  name: string
  displayName: string
  description: string
  status: ServiceStatus
  /** systemd units behind it, e.g. ["cockpit.service", "cockpit.socket"] */
  units: string[]
  /** Since when it has been in its current state (ISO), when known */
  since?: string
  /** Memory used by its processes, bytes */
  memory?: number
  /** Starts with the server */
  enabled?: boolean
  url?: string
  icon: string
  color: string
}

interface ServiceDef {
  name: string
  displayName: string
  /** Main unit first, then the units that start it (socket, timer, path) */
  units: string[]
  /** The units are alternatives (Wi-Fi: whichever is installed), not a group */
  anyOf?: boolean
  url?: string
  icon: string
  color: string
}

// Services followed on the server
const KNOWN_SERVICES: ServiceDef[] = [
  { name: 'cloudflared', displayName: 'Cloudflare Tunnel', units: ['cloudflared.service'], url: link(), icon: 'globe', color: 'blue' },
  { name: 'jellyfin', displayName: 'Jellyfin', units: ['jellyfin.service'], url: link('jellyfin'), icon: 'play-circle', color: 'orange' },
  { name: 'filebrowser', displayName: 'Filebrowser', units: ['filebrowser.service'], url: link('files'), icon: 'folder-open', color: 'purple' },
  // Cockpit is socket-activated: cockpit.service only runs while someone uses it
  { name: 'cockpit', displayName: 'Cockpit', units: ['cockpit.service', 'cockpit.socket'], url: link('cockpit'), icon: 'monitor-check', color: 'teal' },
  {
    name: 'wifi', displayName: 'Wi-Fi', icon: 'wifi', color: 'green', anyOf: true,
    units: [...(process.env.WIFI_SERVICE ? [process.env.WIFI_SERVICE] : []), 'wifi.service', 'NetworkManager.service', 'iwd.service', 'wpa_supplicant.service', 'systemd-networkd.service'],
  },
  { name: 'wifi-watchdog', displayName: 'Surveillance Wi-Fi', units: ['nexus-wifi-watchdog.timer', 'nexus-wifi-watchdog.service'], icon: 'wifi', color: 'green' },
  { name: 'auto-deploy', displayName: 'Déploiement automatique', units: ['nexus-auto-deploy.path', 'nexus-auto-deploy.timer', 'nexus-auto-deploy.service'], icon: 'rocket', color: 'blue' },
  { name: 'postgresql', displayName: 'PostgreSQL', units: ['postgresql.service'], icon: 'database', color: 'blue' },
]

const PROPS = ['Id', 'LoadState', 'ActiveState', 'SubState', 'UnitFileState', 'Description', 'StateChangeTimestamp', 'MemoryCurrent', 'Type']

export interface UnitState {
  Id: string; LoadState: string; ActiveState: string; SubState: string; UnitFileState: string
  Description: string; StateChangeTimestamp: string; MemoryCurrent: string; Type: string
}

/** Parses `systemctl show -p … unit1 unit2`: one block per unit, separated by a blank line. */
export function parseShow(stdout: string): UnitState[] {
  return stdout.trim().split(/\n\s*\n/).filter(Boolean).map((block) => {
    const u: Record<string, string> = {}
    for (const line of block.split('\n')) {
      const eq = line.indexOf('=')
      if (eq > 0) u[line.slice(0, eq)] = line.slice(eq + 1)
    }
    return u as unknown as UnitState
  })
}

const loaded = (u: UnitState) => u.LoadState === 'loaded'
const isTrigger = (id: string) => /\.(socket|timer|path)$/.test(id)

/** What the user should see for a service, from the real state of its units. */
export function serviceState(def: Pick<ServiceDef, 'units' | 'anyOf'>, units: UnitState[]): Omit<ServiceInfo, 'name' | 'displayName' | 'url' | 'icon' | 'color'> {
  let mine = units.filter(loaded)
  if (def.anyOf) mine = mine.slice(0, 1)   // the first one installed
  if (!mine.length) return { status: 'missing', units: def.anyOf ? [] : def.units, description: 'Non installé sur ce serveur' }

  const main = mine[0]
  const service = mine.find((u) => u.Id.endsWith('.service'))
  const trigger = mine.find((u) => isTrigger(u.Id) && u.ActiveState === 'active')
  let status: ServiceStatus
  if (mine.some((u) => u.ActiveState === 'failed')) status = 'failed'
  else if (main.ActiveState === 'active') status = 'active'   // a timer / path that is armed is the service working
  else if (main.ActiveState === 'activating' || main.ActiveState === 'reloading') status = 'activating'
  else if (main.ActiveState === 'deactivating') status = 'deactivating'
  else if (trigger) status = 'waiting'
  else if (main.ActiveState === 'inactive') status = 'inactive'
  else status = 'unknown'
  // A service running right now (Cockpit in use, watchdog during a check) is simply active
  if (status === 'waiting' && service?.ActiveState === 'active' && service.Type !== 'oneshot') status = 'active'

  const ref = status === 'waiting' ? (trigger ?? main) : main
  const ts = Date.parse(ref.StateChangeTimestamp)
  const mem = Number(service?.MemoryCurrent)
  return {
    status,
    units: mine.map((u) => u.Id),
    description: main.Description && main.Description !== main.Id ? main.Description : '',
    since: Number.isFinite(ts) ? new Date(ts).toISOString() : undefined,
    memory: service && service.ActiveState === 'active' && Number.isFinite(mem) && mem > 0 && mem < 2 ** 62 ? mem : undefined,
    enabled: mine.some((u) => u.UnitFileState === 'enabled' || u.UnitFileState === 'static' && isTrigger(u.Id)),
  }
}

async function showUnits(units: string[]): Promise<UnitState[]> {
  const { stdout } = await execFileAsync('systemctl', ['show', '--no-pager', `--property=${PROPS.join(',')}`, ...units], { timeout: 10_000, env: process.env })
  // systemctl answers in the order asked; match by Id anyway (aliases)
  const parsed = parseShow(stdout)
  return units.map((name, i) => parsed.find((u) => u.Id === name) ?? parsed[i] ?? ({ Id: name, LoadState: 'not-found' } as UnitState))
}

const unitsCache = new Map<string, string[]>()

export class ServicesService {
  static async getAll(): Promise<ServiceInfo[]> {
    const all = [...new Set(KNOWN_SERVICES.flatMap((d) => d.units))]
    let states: UnitState[] | null = null
    try { states = await showUnits(all) } catch { /* no systemd here */ }
    return KNOWN_SERVICES.map((def) => {
      const base = { name: def.name, displayName: def.displayName, url: def.url, icon: def.icon, color: def.color }
      if (!states) return { ...base, status: 'unknown' as const, units: def.units, description: def.units[0] }
      const info = serviceState(def, def.units.map((u) => states![all.indexOf(u)]))
      unitsCache.set(def.name, info.units)
      return { ...base, ...info }
    })
  }

  /** Units a command acts on (the installed ones, triggers included so a socket does not restart it). */
  private static async unitsOf(name: string): Promise<string[]> {
    const def = KNOWN_SERVICES.find((s) => s.name === name)
    if (!def) throw new NotFoundError('Service')
    if (!unitsCache.has(name)) await this.getAll()
    const units = unitsCache.get(name) ?? []
    if (!units.length) throw new NotFoundError('Service')
    return units
  }

  static async toggle(name: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
    const units = await this.unitsOf(name)
    // start / restart: the trigger units (socket, timer, path) are enough when there are any,
    // the service itself starts when needed; stop: everything, or the socket would start it again
    const target = action === 'stop' || !units.some(isTrigger) ? units : units.filter(isTrigger)
    await execFileAsync('sudo', ['-n', 'systemctl', action, ...target])
  }

  static async getLogs(name: string, lines = 50): Promise<string[]> {
    const units = await this.unitsOf(name)
    const n = clampLines(lines, 50)

    try {
      const { stdout } = await execFileAsync(
        'journalctl', [...units.flatMap((u) => ['-u', u]), '-n', String(n), '--no-pager', '-o', 'short-iso'],
      )
      return stdout.split('\n').filter(Boolean)
    } catch {
      return ['Unable to fetch logs']
    }
  }
}
