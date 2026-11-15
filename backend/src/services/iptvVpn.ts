import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { logger } from '../utils/logger'
import { countryName } from '../utils/device'

/**
 * The VPN of the IPTV only: when IPTV_PROXY is set (scripts/iptv-vpn.sh sets it), every IPTV
 * request leaves through it — the relay that fetches the streams, the checks, the guide, the
 * YouTube / Twitch / Dailymotion lookups (yt-dlp) — and nothing else of Nexus does (library,
 * downloads, TMDB, Cloudflare Tunnel, updates stay direct).
 *
 * IPTV_PROXY is the local HTTP proxy wireproxy opens (userspace WireGuard, no change to the
 * server's routes): « http://127.0.0.1:25345 ». When the VPN is down, IPTV requests fail
 * instead of going out directly (a stream never leaves outside the VPN once it is set).
 */

/** The IPTV's proxy address, or null (no VPN: direct). Only http://host:port is accepted. */
export function iptvProxyUrl(): string | null {
  const raw = (process.env.IPTV_PROXY || '').trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' || !u.port || u.pathname.replace(/\/$/, '') || u.search) throw new Error('form')
    return `http://${u.username ? `${u.username}:${u.password}@` : ''}${u.host}`
  } catch {
    logger.warn('IPTV_PROXY ignored: expected http://host:port')
    return null
  }
}

let agent: { url: string; dispatcher: ProxyAgent } | null = null
function dispatcher(url: string) {
  if (agent?.url !== url) agent = { url, dispatcher: new ProxyAgent(url) }
  return agent.dispatcher
}

/** fetch() for the IPTV: through the VPN when it is set, else direct. */
export function iptvFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const proxy = iptvProxyUrl()
  if (!proxy) return fetch(input, init)
  return undiciFetch(input, { ...(init as object), dispatcher: dispatcher(proxy) } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>
}

/**
 * Variables for the IPTV's Python module (urllib and yt-dlp take the proxy from them). The module
 * only talks to the Internet, so nothing is left out of the VPN (no NO_PROXY).
 */
export function iptvProxyEnv(): Record<string, string> {
  const proxy = iptvProxyUrl()
  if (!proxy) return {}
  return { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, NO_PROXY: '', no_proxy: '' }
}

export interface VpnStatus {
  configured: boolean
  /** The VPN answers */
  ok?: boolean
  /** Where the IPTV comes out: its public IP and country */
  ip?: string
  country?: string
  countryCode?: string
  error?: string
  checkedAt?: string
}

const CHECK_URL = () => process.env.IPTV_VPN_CHECK_URL || 'https://www.cloudflare.com/cdn-cgi/trace'
let cached: { at: number; proxy: string; status: VpnStatus } | null = null

/** Is the VPN up, and where does the IPTV come out? (Cloudflare's trace, through the VPN; kept 60 s) */
export async function vpnStatus(force = false): Promise<VpnStatus> {
  const proxy = iptvProxyUrl()
  if (!proxy) return { configured: false }
  if (!force && cached && cached.proxy === proxy && Date.now() - cached.at < 60_000) return cached.status
  let status: VpnStatus
  try {
    const res = await iptvFetch(CHECK_URL(), { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const trace = Object.fromEntries((await res.text()).split('\n').map((l) => l.split('=')).filter((p) => p.length === 2)) as Record<string, string>
    const code = (trace.loc || '').toUpperCase()
    status = { configured: true, ok: true, ip: trace.ip || undefined, countryCode: code || undefined, country: countryName(code) ?? undefined }
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } }
    status = { configured: true, ok: false, error: e.cause?.code || e.cause?.message || e.message }
  }
  status.checkedAt = new Date().toISOString()
  cached = { at: Date.now(), proxy, status }
  return status
}
