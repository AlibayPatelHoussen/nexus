import type { Request } from 'express'

/**
 * Who is signing in, from where: the device (« iPhone · Safari »), the IP address and the
 * approximate place. Nexus is reached through Cloudflare Tunnel: Cloudflare gives the real
 * IP (CF-Connecting-IP), the country (CF-IPCountry) and, when « Add visitor location
 * headers » is on (Rules › Managed Transforms), the city and region. Those headers are only
 * believed when the request comes from this machine (cloudflared runs next to Nexus):
 * someone on the local network cannot fake them.
 */

export interface ClientInfo {
  ip: string | null
  userAgent: string | null
  device: string
  location: string | null
}

const OS: [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/iPod/, 'iPod'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Macintosh|Mac OS X/, 'Mac'],
  [/Linux/, 'Linux'],
]

const BROWSERS: [RegExp, string][] = [
  [/EdgA?\/|EdgiOS\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/CriOS\/|Chrome\//, 'Chrome'],
  [/Version\/[\d.]+.*Safari\//, 'Safari'],
  [/curl\//, 'curl'],
  [/python-requests|python-urllib/i, 'Python'],
  [/node-fetch|undici|axios/i, 'Node.js'],
]

/** « iPhone · Safari », « Windows · Chrome », « Mac · Firefox »… (« Appareil inconnu » when it says nothing). */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ''
  const os = OS.find(([re]) => re.test(ua))?.[1]
  let browser = BROWSERS.find(([re]) => re.test(ua))?.[1]
  // iOS apps (and the home-screen web app on old iOS) show WebKit without « Safari/ »
  if (!browser && /iPhone|iPad|iPod/.test(ua) && /AppleWebKit/.test(ua)) browser = 'app'
  if (os && browser) return `${os} · ${browser}`
  return os ?? browser ?? 'Appareil inconnu'
}

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fc|fd|fe80:|127\.|::1$)/i

const bare = (ip: string) => ip.replace(/^::ffff:/, '').trim()

/** Headers set by Cloudflare are only believed when the request came from this machine (cloudflared). */
function fromTunnel(req: Request): boolean {
  return LOOPBACK.test(req.socket?.remoteAddress ?? '')
}

/**
 * Node reads header bytes as latin1: a UTF-8 place name (« Auvergne-Rhône-Alpes ») arrives as
 * « Auvergne-RhÃ´ne-Alpes ». Read again as UTF-8 when that is what it is; %-encoded values too.
 */
export function headerText(raw: string): string {
  let s = raw
  const codes = [...s].map((c) => c.charCodeAt(0))
  if (codes.some((c) => c >= 0x80) && codes.every((c) => c <= 0xff)) {
    const utf8 = Buffer.from(s, 'latin1').toString('utf8')
    if (!utf8.includes('\uFFFD')) s = utf8
  }
  if (/%[0-9A-Fa-f]{2}/.test(s)) { try { s = decodeURIComponent(s) } catch { /* keep it */ } }
  return s
}

function header(req: Request, name: string): string | null {
  const v = req.headers[name]
  const s = (Array.isArray(v) ? v[0] : v)?.trim()
  return s ? headerText(s).slice(0, 80) : null
}

export function clientIp(req: Request): string | null {
  const cf = fromTunnel(req) ? header(req, 'cf-connecting-ip') : null
  const ip = cf ?? req.ip ?? req.socket?.remoteAddress ?? null
  return ip ? bare(ip).slice(0, 64) : null
}

const countryNames = (() => {
  try { return new Intl.DisplayNames(['fr'], { type: 'region' }) } catch { return null }
})()

/** « FR » → « France » (« XX » unknown, « T1 » Tor). */
export function countryName(code: string | null): string | null {
  if (!code) return null
  const c = code.toUpperCase()
  if (c === 'XX') return null
  if (c === 'T1') return 'réseau Tor'
  if (!/^[A-Z]{2}$/.test(c)) return null
  try { return countryNames?.of(c) ?? c } catch { return c }
}

/** « Lyon, Auvergne-Rhône-Alpes, France », « France », « Réseau local », or null when unknown. */
export function clientLocation(req: Request, ip = clientIp(req)): string | null {
  if (ip && PRIVATE.test(ip)) return 'Réseau local'
  if (!fromTunnel(req)) return null
  const city = header(req, 'cf-ipcity')
  const region = header(req, 'cf-region')
  const country = countryName(header(req, 'cf-ipcountry'))
  const parts: string[] = []
  for (const p of [city, region, country]) if (p && !parts.includes(p)) parts.push(p)
  return parts.length ? parts.join(', ').slice(0, 160) : null
}

export function clientInfo(req: Request): ClientInfo {
  const ua = req.get('user-agent')?.slice(0, 400) ?? null
  const ip = clientIp(req)
  return { ip, userAgent: ua, device: deviceLabel(ua), location: clientLocation(req, ip) }
}
