import axios from 'axios'
import { rememberIptvUrl } from '@/components/shell/access'

export const FRONTEND_COMMIT: string = typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : 'dev'

export interface ServerHealth {
  status:     string
  build?:     { commit: string; builtAt: string | null }
  startedAt?: string
  /** The IPTV's own subdomain (Nexus opened there shows the IPTV only) */
  iptvUrl?:   string | null
}

export async function getServerHealth(): Promise<ServerHealth> {
  const { data } = await axios.get<ServerHealth>('/api/health', { headers: { Accept: 'application/json' } })
  if (typeof data !== 'object' || !data) throw new Error('Invalid /api/health response')
  if ('iptvUrl' in data) rememberIptvUrl(data.iptvUrl)
  return data
}

/**
 * True when the running backend was not built from the same commit as this UI
 * (typical when a deploy rebuilt the frontend but the backend was not restarted).
 */
export function isBackendOutdated(health: ServerHealth | undefined): boolean {
  if (!health || FRONTEND_COMMIT === 'dev') return false
  const commit = health.build?.commit
  if (!commit) return true                  // old backend: no build info at all
  if (commit === 'dev' || commit === 'unknown') return false
  return commit !== FRONTEND_COMMIT
}
