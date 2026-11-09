import dgram from 'dgram'
import os from 'os'
import path from 'path'
import { logger } from '../utils/logger'
import { NotFoundError, AppError } from '../utils/errors'

/*
 * « Diffuser sur la TV » from the server: the TV fetches the video from Nexus itself, so it
 * works with every browser and keeps playing when the phone is locked.
 * - DLNA / UPnP renderers (Samsung, LG, Sony, Philips, Panasonic, many Android TV / Fire TV,
 *   Kodi, VLC…): AVTransport SOAP actions;
 * - Roku (TV and players): External Control Protocol, « Play on Roku » input.
 * Devices are only those answering the SSDP search on the server's network: a request can
 * never make the server call an address it did not discover itself.
 * (AirPlay and Chromecast are offered by the browser itself: see the player.)
 */

export type CastKind = 'dlna' | 'roku'
export interface CastDevice {
  id:    string
  name:  string
  kind:  CastKind
  model: string | null
  host:  string
  /** Roku: ECP base (http://ip:8060/); DLNA: AVTransport control URL */
  url:   string
  /** DLNA: service type of AVTransport (version 1 or 2) */
  service?: string
  seen:  number
}
export interface CastStatus {
  state:    'playing' | 'paused' | 'stopped' | 'loading' | 'idle'
  position: number | null
  duration: number | null
}

const SSDP_ADDR = '239.255.255.250'
const SSDP_PORT = 1900
const SEARCH_TARGETS = ['urn:schemas-upnp-org:service:AVTransport:1', 'urn:schemas-upnp-org:device:MediaRenderer:1', 'roku:ecp']
const HTTP_TIMEOUT = 4000
const FORGET_AFTER = 10 * 60_000

const devices = new Map<string, CastDevice>()

// ─── Small XML helpers (device descriptions and SOAP answers are tiny) ─────
const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&amp;/g, '&')
export const xmlEscape = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
export function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i').exec(xml)
  return m ? decode(m[1].trim()) : null
}

/** LOCATION of an SSDP answer (or NOTIFY), with its USN. */
export function parseSsdp(msg: string): { location: string; usn: string | null } | null {
  const header = (h: string) => new RegExp(`^${h}:\\s*(.+)$`, 'im').exec(msg)?.[1].trim() ?? null
  const location = header('LOCATION')
  if (!location || !/^https?:\/\//i.test(location)) return null
  return { location, usn: header('USN') }
}

/** A UPnP device description → a castable device (null when it cannot play media). */
export function parseDescription(xml: string, location: string): CastDevice | null {
  const host = new URL(location).hostname
  const name = tag(xml, 'friendlyName') || host
  const model = tag(xml, 'modelName')
  const udn = tag(xml, 'UDN') || location
  if (/urn:roku-com:device/i.test(xml)) {
    return { id: `roku:${tag(xml, 'serialNumber') || udn}`, name, kind: 'roku', model, host, url: new URL('/', location).toString(), seen: Date.now() }
  }
  for (const block of xml.match(/<service>[\s\S]*?<\/service>/gi) ?? []) {
    const type = tag(block, 'serviceType') || ''
    if (!/:service:AVTransport:\d/i.test(type)) continue
    const control = tag(block, 'controlURL')
    if (!control) continue
    const base = tag(xml, 'URLBase') || location
    return { id: `dlna:${udn}`, name, kind: 'dlna', model, host, url: new URL(control, base).toString(), service: type, seen: Date.now() }
  }
  return null
}

const ROKU_REFUSED = 'La Roku refuse les commandes du réseau. Sur la TV : Paramètres › Système › Paramètres système avancés › ' +
  'Contrôle par les applications mobiles › Accès réseau › « Permissif ». Les Roku récentes ont aussi retiré la lecture d’une vidéo ' +
  'envoyée ainsi : utilise plutôt AirPlay depuis l’iPhone (les TV Roku le gèrent).'

async function fetchText(url: string, init: RequestInit = {}, roku = false): Promise<string> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT) })
  } catch {
    throw new AppError('La TV ne répond pas (éteinte, ou plus sur le réseau du serveur)', 502, true, 'CAST_UNREACHABLE')
  }
  const text = await res.text()
  if (roku && (res.status === 401 || res.status === 403)) throw new AppError(ROKU_REFUSED, 502, true, 'CAST_ROKU_REFUSED')
  if (!res.ok) throw new AppError(`La TV a refusé la commande (erreur ${res.status})`, 502, true, 'CAST_DEVICE_ERROR')
  return text
}

/** Reads the description at `location` and remembers the device (SSDP answers and tests). */
export async function probeLocation(location: string): Promise<CastDevice | null> {
  try {
    const xml = await fetchText(location)
    const d = parseDescription(xml, location)
    if (!d) return null
    if (d.kind === 'roku') {
      // The name set by the owner (« TV du salon ») rather than the model
      try {
        const info = await fetchText(new URL('query/device-info', d.url).toString())
        d.name = tag(info, 'user-device-name') || tag(info, 'friendly-device-name') || d.name
        d.model = tag(info, 'friendly-model-name') || tag(info, 'model-name') || d.model
      } catch { /* the description is enough */ }
    }
    devices.set(d.id, d)
    return d
  } catch (err) {
    logger.debug(`Cast: ${location} unreadable: ${err}`)
    return null
  }
}

/** SSDP search on the server's network, `wait` ms; returns every device known now. */
export async function discover(wait = 2500): Promise<CastDevice[]> {
  const locations = new Set<string>()
  await new Promise<void>((resolve) => {
    let socket: dgram.Socket
    try { socket = dgram.createSocket({ type: 'udp4', reuseAddr: true }) } catch { resolve(); return }
    const done = () => { try { socket.close() } catch { /* closed */ } resolve() }
    socket.on('error', (err) => { logger.warn(`Cast search: ${err.message}`); done() })
    socket.on('message', (buf) => { const r = parseSsdp(buf.toString()); if (r) locations.add(r.location) })
    socket.bind(0, () => {
      for (const st of SEARCH_TARGETS) {
        const msg = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDR}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`)
        // Twice: UDP may drop the first one
        for (const delay of [0, 400]) setTimeout(() => socket.send(msg, SSDP_PORT, SSDP_ADDR, () => {}), delay)
      }
      setTimeout(done, wait)
    })
  })
  await Promise.all([...locations].map(probeLocation))
  const now = Date.now()
  for (const [id, d] of devices) if (now - d.seen > FORGET_AFTER) devices.delete(id)
  return listDevices()
}

export const listDevices = () => [...devices.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
export function getDevice(id: string): CastDevice {
  const d = devices.get(id)
  if (!d) throw new NotFoundError('TV')
  return d
}
/** Tests */
export const forgetDevices = () => devices.clear()

/**
 * Address the TV uses to reach Nexus: CAST_BASE_URL when set (other port, reverse proxy),
 * else this server's address on the TV's network and the port the backend listens on.
 */
export function baseUrlFor(deviceHost: string): string {
  if (process.env.CAST_BASE_URL) return process.env.CAST_BASE_URL.replace(/\/+$/, '')
  const port = process.env.PORT || '3001'
  const addrs = Object.values(os.networkInterfaces()).flat()
    .filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === 'IPv4' && !a.internal).map((a) => a.address)
  const prefix = (ip: string) => ip.split('.').slice(0, 3).join('.')
  const ip = addrs.find((a) => prefix(a) === prefix(deviceHost)) ?? addrs[0] ?? '127.0.0.1'
  return `http://${ip}:${port}`
}

// ─── DLNA (UPnP AVTransport) ──────────────────────────
const DLNA_FLAGS = 'DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000'
const VIDEO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.avi': 'video/x-msvideo', '.mov': 'video/quicktime',
}
export const videoMime = (file: string) => VIDEO_MIME[path.extname(file).toLowerCase()] || 'video/mp4'
export const DLNA_STREAM_HEADERS = { 'transferMode.dlna.org': 'Streaming', 'contentFeatures.dlna.org': DLNA_FLAGS }

export function didl(title: string, url: string, mime: string): string {
  return '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1">' +
    `<dc:title>${xmlEscape(title)}</dc:title><upnp:class>object.item.videoItem.movie</upnp:class>` +
    `<res protocolInfo="http-get:*:${mime}:${DLNA_FLAGS}">${xmlEscape(url)}</res></item></DIDL-Lite>`
}

async function soap(d: CastDevice, action: string, args: Record<string, string | number> = {}): Promise<string> {
  const service = d.service || 'urn:schemas-upnp-org:service:AVTransport:1'
  const body = Object.entries({ InstanceID: 0, ...args }).map(([k, v]) => `<${k}>${xmlEscape(String(v))}</${k}>`).join('')
  return fetchText(d.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"${service}#${action}"` },
    body: '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
      `s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${service}">${body}</u:${action}></s:Body></s:Envelope>`,
  })
}

const hms = (s: number) => {
  const t = Math.max(0, Math.floor(s))
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
const seconds = (v: string | null) => {
  if (!v || !/^\d+:\d{2}:\d{2}/.test(v)) return null
  const [h, m, s] = v.split(':').map(parseFloat)
  return h * 3600 + m * 60 + s
}

// ─── Commands ──────────────────────────────────────────
export async function castPlay(d: CastDevice, url: string, title: string, file: string, startAt = 0): Promise<void> {
  if (d.kind === 'roku') {
    const ext = path.extname(file).slice(1).toLowerCase() || 'mp4'
    const q = new URLSearchParams({ t: 'v', u: url, k: '(null)', videoName: title, videoFormat: ext === 'm4v' ? 'mp4' : ext })
    await fetchText(new URL(`input/15985?${q}`, d.url).toString(), { method: 'POST' }, true)
    return
  }
  // Some renderers refuse a new media while playing: stopped first (errors ignored)
  await soap(d, 'Stop').catch(() => {})
  await soap(d, 'SetAVTransportURI', { CurrentURI: url, CurrentURIMetaData: didl(title, url, videoMime(file)) })
  await soap(d, 'Play', { Speed: 1 })
  if (startAt > 5) {
    // The TV only accepts a position once the video is loaded
    void (async () => {
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        try { await soap(d, 'Seek', { Unit: 'REL_TIME', Target: hms(startAt) }); return } catch { /* not ready yet */ }
      }
    })()
  }
}

export async function castStatus(d: CastDevice): Promise<CastStatus> {
  if (d.kind === 'roku') {
    const xml = await fetchText(new URL('query/media-player', d.url).toString(), {}, true)
    const state = /<player[^>]*\sstate="([^"]+)"/i.exec(xml)?.[1] ?? 'none'
    const ms = (n: string) => { const v = tag(xml, n); return v ? parseInt(v, 10) / 1000 : null }
    return {
      state: state === 'play' ? 'playing' : state === 'pause' ? 'paused' : state === 'buffer' || state === 'startup' ? 'loading'
        : state === 'stop' ? 'stopped' : 'idle',
      position: ms('position'), duration: ms('duration'),
    }
  }
  const [info, pos] = await Promise.all([soap(d, 'GetTransportInfo'), soap(d, 'GetPositionInfo').catch(() => '')])
  const st = tag(info, 'CurrentTransportState') || ''
  return {
    state: st === 'PLAYING' ? 'playing' : st === 'PAUSED_PLAYBACK' ? 'paused' : st === 'TRANSITIONING' ? 'loading'
      : st === 'STOPPED' ? 'stopped' : 'idle',
    position: seconds(tag(pos, 'RelTime')),
    duration: seconds(tag(pos, 'TrackDuration')),
  }
}

export async function castControl(d: CastDevice, action: 'play' | 'pause' | 'stop' | 'seek', position = 0): Promise<void> {
  if (d.kind === 'roku') {
    if (action === 'seek') throw new AppError('Une Roku ne permet pas de choisir la position à distance', 422, true, 'CAST_UNSUPPORTED')
    if (action === 'stop') { await fetchText(new URL('keypress/Back', d.url).toString(), { method: 'POST' }, true); return }
    // Play is a toggle on Roku: only sent when it changes something
    const { state } = await castStatus(d)
    if ((action === 'play') !== (state === 'playing')) await fetchText(new URL('keypress/Play', d.url).toString(), { method: 'POST' }, true)
    return
  }
  if (action === 'play') await soap(d, 'Play', { Speed: 1 })
  else if (action === 'pause') await soap(d, 'Pause')
  else if (action === 'stop') await soap(d, 'Stop')
  else await soap(d, 'Seek', { Unit: 'REL_TIME', Target: hms(position) })
}
