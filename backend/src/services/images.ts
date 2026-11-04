import axios from 'axios'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { logger } from '../utils/logger'

/**
 * Image proxy + disk cache for posters, backdrops and episode stills.
 *
 * External artwork is never loaded by the browser directly:
 * - AniList serves covers from s{N}.anilist.co (blocked by our CSP before),
 * - MangaDex forbids hotlinking its covers,
 * - caching avoids downloading the same image again on every page view.
 */
const CACHE_DIR = process.env.IMAGE_CACHE_DIR || path.resolve(__dirname, '../../cache/images')
const MAX_BYTES = 15 * 1024 * 1024
const ALLOWED_HOSTS = [
  /^image\.tmdb\.org$/,
  /^([a-z0-9-]+\.)*anilist\.co$/,
  /^([a-z0-9-]+\.)*mangadex\.org$/,
  /^([a-z0-9-]+\.)*kitsu\.io$/,
  ...(process.env.IMAGE_PROXY_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean)
    .map((h) => new RegExp(`^${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '.*')}$`)),
]

export const isRemote = (url: unknown): url is string => typeof url === 'string' && /^https?:\/\//i.test(url)

export function isAllowed(url: string): boolean {
  try {
    const u = new URL(url)
    return (u.protocol === 'https:' || u.protocol === 'http:') && ALLOWED_HOSTS.some((re) => re.test(u.hostname))
  } catch { return false }
}

/** Short stable version of a URL: changes when the artwork changes (cache busting). */
export const urlVersion = (url: string) => crypto.createHash('sha1').update(url).digest('hex').slice(0, 10)

/** URL the browser should use for a stored artwork (proxied when remote). */
export function proxied(kind: 'media' | 'episode', id: string, field: string, url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null
  // Local artwork (YouTube thumbnail next to the video) is served by the same route
  const local = url.startsWith('/') && !url.startsWith('/api/')
  if (!isRemote(url) && !local) return url      // data: URIs…
  const suffix = kind === 'media' ? `/${field}` : ''
  return `/api/images/${kind}/${id}${suffix}?v=${urlVersion(url)}`
}

// ─── Signed URLs: artwork of download search results (any site) ────────────
// The server signs the URLs it hands out itself, so /api/images/remote cannot
// be used as an open proxy by anyone else.
const signKey = () => `img:${process.env.JWT_SECRET || 'nexus'}`
const signature = (url: string) => crypto.createHmac('sha256', signKey()).update(url).digest('base64url').slice(0, 32)

export function signedImage(url: unknown): string | null {
  if (!isRemote(url)) return typeof url === 'string' && url ? url : null
  return `/api/images/remote?u=${encodeURIComponent(url)}&s=${signature(url)}`
}

export function validSignature(url: unknown, sig: unknown): url is string {
  if (!isRemote(url) || typeof sig !== 'string' || url.length > 4000) return false
  const a = Buffer.from(signature(url)), b = Buffer.from(sig)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

const inflight = new Map<string, Promise<{ file: string; type: string }>>()

/** Download (once) and return the cached file of an allowed (or signed) remote image. */
export function cachedImage(url: string, trusted = false): Promise<{ file: string; type: string }> {
  if (!trusted && !isAllowed(url)) return Promise.reject(new Error(`host not allowed: ${url}`))
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol')
    // Never fetch the server itself or the local network through a signed URL
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|0\.)/i.test(u.hostname) && trusted
        && process.env.NODE_ENV === 'production' && process.env.IMAGE_PROXY_ALLOW_LOCAL !== '1') throw new Error('local address')
  } catch (err) {
    return Promise.reject(new Error(`bad image url (${(err as Error).message}): ${url}`))
  }
  const key  = crypto.createHash('sha1').update(url).digest('hex')
  const file = path.join(CACHE_DIR, key.slice(0, 2), key)
  const meta = `${file}.type`

  const existing = inflight.get(key)
  if (existing) return existing

  const job = (async () => {
    try {
      const [type] = await Promise.all([fs.promises.readFile(meta, 'utf8'), fs.promises.access(file)])
      return { file, type }
    } catch { /* not cached yet */ }

    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 15_000,
      maxContentLength: MAX_BYTES,
      // No Referer: image CDNs (MangaDex) refuse hotlinked requests coming from other sites
      headers: { 'User-Agent': 'Nexus/1.0 (self-hosted media center)', Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      validateStatus: (s) => s === 200,
    })
    const type = String(res.headers['content-type'] || '').split(';')[0].trim()
    if (!type.startsWith('image/')) throw new Error(`not an image (${type || 'no content-type'}): ${url}`)

    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await fs.promises.writeFile(tmp, Buffer.from(res.data))
    await fs.promises.rename(tmp, file)
    await fs.promises.writeFile(meta, type)
    return { file, type }
  })()

  inflight.set(key, job)
  job.catch((err: Error) => logger.warn(`Image proxy: ${err.message}`)).finally(() => inflight.delete(key))
  return job
}
