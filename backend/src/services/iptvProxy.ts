import crypto from 'crypto'
import dns from 'dns/promises'
import net from 'net'
import { Readable } from 'stream'
import type { Request, Response } from 'express'
import { logger } from '../utils/logger'
import type { IptvStream } from './iptv'

/*
 * Relay of the IPTV streams for the browser player.
 *
 * Why: many IPTV servers send no CORS headers or serve plain http (refused on an https page),
 * and some need a Referer / User-Agent a browser cannot set. Nexus fetches the stream itself
 * and passes it on as it comes (nothing is stored).
 *
 * Safety (no open proxy):
 * - the entry point is a catalogue stream (channel id + stream index), never a URL from the client;
 * - every address inside a relayed playlist (variants, segments, keys, subtitles) is rewritten
 *   to /seg with an HMAC signature of (channel, stream, url): only addresses the playlists
 *   themselves gave can be fetched;
 * - local / private addresses are refused (except IPTV_ALLOW_PRIVATE=1, for tests);
 * - timeouts, a size limit on playlists, the upstream request is aborted when the player leaves.
 */

const HEADER_TIMEOUT = 15_000
const MAX_PLAYLIST = 2 * 1024 * 1024
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const key = () => `iptv:${process.env.JWT_SECRET || 'nexus'}`
export const signUrl = (id: string, s: number, url: string) =>
  crypto.createHmac('sha256', key()).update(`${id}|${s}|${url}`).digest('base64url').slice(0, 24)
export function validUrlSignature(id: string, s: number, url: string, sig: unknown): boolean {
  if (typeof sig !== 'string') return false
  const a = Buffer.from(signUrl(id, s, url)), b = Buffer.from(sig)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const v6 = ip.toLowerCase()
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') ||
    (v6.startsWith('::ffff:') && privateIp(v6.slice(7)))
}

async function assertPublic(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocole refusé')
  if (process.env.IPTV_ALLOW_PRIVATE === '1') return
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address)
  if (!addrs.length || addrs.some(privateIp)) throw new Error('adresse locale refusée')
}

/** One upstream GET (redirects followed, each hop checked). */
async function upstream(url: string, stream: IptvStream, req: Request, signal: AbortSignal): Promise<globalThis.Response> {
  let current = new URL(url)
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(current)
    const headers: Record<string, string> = { 'User-Agent': stream.user_agent || UA, Accept: '*/*' }
    if (stream.referrer) {
      headers.Referer = stream.referrer
      try { headers.Origin = new URL(stream.referrer).origin } catch { /* not a URL */ }
    }
    if (typeof req.headers.range === 'string') headers.Range = req.headers.range
    const res = await fetch(current, { headers, redirect: 'manual', signal })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel().catch(() => {})
      current = new URL(res.headers.get('location')!, current)
      continue
    }
    Object.defineProperty(res, 'finalUrl', { value: current.toString() })
    return res
  }
  throw new Error('trop de redirections')
}

const isPlaylistType = (type: string | null) => !!type && /mpegurl|m3u/i.test(type)

/** Rewrites every URI of an HLS playlist to the signed relay. */
export function rewritePlaylist(text: string, base: string, toRelay: (absolute: string) => string): string {
  const abs = (u: string) => { try { return new URL(u.trim(), base).toString() } catch { return null } }
  return text.split(/\r?\n/).map((line) => {
    const t = line.trim()
    if (!t) return line
    if (t.startsWith('#')) {
      // URI="…" in #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA, #EXT-X-I-FRAME-STREAM-INF, #EXT-X-SESSION-KEY…
      return line.replace(/URI="([^"]+)"/g, (m, u: string) => {
        if (u.startsWith('data:') || u.startsWith('skd:')) return m
        const a = abs(u)
        return a ? `URI="${toRelay(a)}"` : m
      })
    }
    const a = abs(t)
    return a ? toRelay(a) : line
  }).join('\n')
}

const AUDIO_CODEC = /^(mp4a|ac-[34]|ec-3|opus|flac|vorbis|alac|mp3)/
const TEXT_CODEC = /^(stpp|wvtt)/

/**
 * Leaves the sound-only variants out of a playlist of qualities (for slow networks, often listed
 * first). A player that starts on one may never show the picture: hls.js cannot bring it in
 * afterwards, Safari on iPhone plays the sound over a black screen until the stream is loaded
 * again. A variant goes when it has no picture and another one may have:
 * - it announces sound codecs only (CODECS without a video codec, no RESOLUTION);
 * - it announces nothing while others announce a picture, all at a higher bitrate;
 * - nothing is announced anywhere, and its bitrate (under 200 kb/s, less than half of another
 *   variant's) only fits sound.
 * A playlist of sound-only variants (a radio) is kept as it is.
 */
export function dropSoundOnlyVariants(text: string): string {
  const lines = text.split(/\r?\n/)
  const attr = (line: string, name: string) => new RegExp(`(?:^|[:,])${name}=(?:"([^"]*)"|([^,]*))`, 'i').exec(line)
  const variants: { from: number; to: number; video: boolean; sound: boolean; bandwidth: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const tag = lines[i].trim()
    if (!/^#EXT-X-STREAM-INF:/i.test(tag)) continue
    // Its address: the next line that is not a comment
    let u = i + 1
    while (u < lines.length && (!lines[u].trim() || (lines[u].trim().startsWith('#') && !/^#EXT-X-STREAM-INF:/i.test(lines[u].trim())))) u++
    if (u >= lines.length || lines[u].trim().startsWith('#')) continue
    const found = attr(tag, 'CODECS')
    const codecs = found ? (found[1] ?? found[2] ?? '').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean) : []
    const video = !!attr(tag, 'RESOLUTION') || codecs.some((c) => !AUDIO_CODEC.test(c) && !TEXT_CODEC.test(c))
    const bandwidth = attr(tag, 'BANDWIDTH')
    variants.push({ from: i, to: u, video, sound: !video && codecs.some((c) => AUDIO_CODEC.test(c)), bandwidth: Number(bandwidth?.[1] ?? bandwidth?.[2] ?? 0) || 0 })
  }
  if (variants.length < 2) return text
  const pictured = variants.filter((v) => v.video)
  const top = Math.max(...variants.map((v) => v.bandwidth))
  const drop = variants.filter((v) => !v.video && (
    v.sound ? variants.some((o) => !o.sound)
      : pictured.length ? pictured.every((o) => o.bandwidth > v.bandwidth)
        : v.bandwidth > 0 && v.bandwidth < 200_000 && top >= 2 * v.bandwidth))
  if (!drop.length || drop.length === variants.length) return text
  const gone = new Set<number>()
  for (const v of drop) for (let i = v.from; i <= v.to; i++) gone.add(i)
  return lines.filter((_, i) => !gone.has(i)).join('\n')
}

/**
 * Sends the stream at `url` to the player: playlists rewritten, anything else passed on as it
 * comes (segments, keys; Range kept for players that ask for parts).
 * `entry`: the address of the channel itself (not a segment of it), which must be a video stream —
 * a web page, an XML or JSON answer is refused with its reason instead of being handed to the player.
 * -> false when nothing could be sent (the answer already says why).
 */
export async function relay(req: Request, res: Response, opts: {
  id: string; s: number; url: string; stream: IptvStream; relayPath: (abs: string) => string; entry?: boolean
}): Promise<boolean> {
  const ctrl = new AbortController()
  const abort = () => ctrl.abort()
  req.on('close', abort)
  const timer = setTimeout(abort, HEADER_TIMEOUT)
  let up: globalThis.Response
  try {
    up = await upstream(opts.url, opts.stream, req, ctrl.signal)
  } catch (err) {
    clearTimeout(timer)
    const msg = (err as Error).name === 'AbortError' ? 'délai dépassé' : (err as Error).message
    if (!res.headersSent) res.status(502).json({ success: false, error: `Flux injoignable (${msg})` })
    return false
  }
  clearTimeout(timer)
  if (!up.ok && up.status !== 206) {
    await up.body?.cancel().catch(() => {})
    const why = up.status === 403 || up.status === 401 || up.status === 451 ? 'accès refusé, souvent géo-bloqué' : `HTTP ${up.status}`
    res.status(502).json({ success: false, error: `Flux indisponible (${why})`, upstream: up.status })
    return false
  }
  const finalUrl = (up as unknown as { finalUrl: string }).finalUrl || opts.url
  const type = up.headers.get('content-type')
  const path = new URL(finalUrl).pathname.toLowerCase()

  // A playlist: read it whole (small), rewrite, send. Some servers send them as text/plain or
  // octet-stream from a .php address: the first bytes tell (#EXTM3U).
  const body = up.body
  if (!body) { res.status(502).json({ success: false, error: 'Flux vide' }); return false }
  const reader = body.getReader()
  const first = await reader.read().catch(() => ({ done: true, value: undefined }))
  const head = first.value ? Buffer.from(first.value) : Buffer.alloc(0)
  const looksPlaylist = isPlaylistType(type) || path.endsWith('.m3u8') || path.endsWith('.m3u') ||
    head.subarray(0, 32).toString('utf8').replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U')

  if (looksPlaylist) {
    const chunks: Buffer[] = [head]
    let size = head.length
    let done = first.done
    while (!done) {
      const next = await reader.read()
      done = next.done
      if (next.value) {
        size += next.value.length
        if (size > MAX_PLAYLIST) { await reader.cancel().catch(() => {}); res.status(502).json({ success: false, error: 'Playlist trop grande' }); return false }
        chunks.push(Buffer.from(next.value))
      }
    }
    const text = Buffer.concat(chunks).toString('utf8')
    if (!text.trimStart().replace(/^\uFEFF/, '').startsWith('#EXTM3U')) {
      res.status(502).json({ success: false, error: 'Le flux ne renvoie pas une playlist HLS' })
      return false
    }
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
    res.setHeader('Cache-Control', 'no-store')
    res.send(rewritePlaylist(dropSoundOnlyVariants(text), finalUrl, opts.relayPath))
    return true
  }

  if (opts.entry) {
    const start = head.subarray(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart()
    if (/html|xml|json/i.test(type ?? '') || /^[<{[]/.test(start)) {
      await reader.cancel().catch(() => {})
      const dash = /dash\+xml/i.test(type ?? '') || path.endsWith('.mpd') || /<mpd[\s>]/i.test(start)
      res.status(502).json({ success: false, error: dash ? 'Flux au format DASH, non pris en charge par le lecteur' : 'Le flux renvoie une page web, pas une vidéo' })
      return false
    }
  }

  // Segments, keys, direct streams: passed on as they come
  res.status(up.status)
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = up.headers.get(h)
    if (v) res.setHeader(h, v)
  }
  res.setHeader('Cache-Control', 'no-store')
  if (head.length) res.write(head)
  if (first.done) { res.end(); return true }
  const rest = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) controller.close()
        else controller.enqueue(value)
      } catch (err) { controller.error(err) }
    },
    cancel() { void reader.cancel().catch(() => {}) },
  })
  const node = Readable.fromWeb(rest as import('stream/web').ReadableStream)
  node.on('error', (err) => {
    if (!ctrl.signal.aborted) logger.debug(`IPTV relay ${opts.id}: ${err.message}`)
    res.destroy()
  })
  node.pipe(res)
  return true
}
