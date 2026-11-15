import type { Request } from 'express'
import { clientInfo, countryName, deviceLabel, headerText } from '../../src/utils/device'

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  iphoneApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
}

describe('device label', () => {
  it('names the device and browser like a person would', () => {
    expect(deviceLabel(UA.iphone)).toBe('iPhone · Safari')
    expect(deviceLabel(UA.iphoneChrome)).toBe('iPhone · Chrome')
    expect(deviceLabel(UA.iphoneApp)).toBe('iPhone · app')
    expect(deviceLabel(UA.ipad)).toBe('iPad · Safari')
    expect(deviceLabel(UA.mac)).toBe('Mac · Safari')
    expect(deviceLabel(UA.windowsEdge)).toBe('Windows · Edge')
    expect(deviceLabel(UA.android)).toBe('Android · Chrome')
    expect(deviceLabel(UA.samsung)).toBe('Android · Samsung Internet')
    expect(deviceLabel(UA.linuxFirefox)).toBe('Linux · Firefox')
    expect(deviceLabel('curl/8.5.0')).toBe('curl')
    expect(deviceLabel('')).toBe('Appareil inconnu')
    expect(deviceLabel(null)).toBe('Appareil inconnu')
  })
})

describe('place', () => {
  it('names countries in French', () => {
    expect(countryName('FR')).toBe('France')
    expect(countryName('mg')).toBe('Madagascar')
    expect(countryName('XX')).toBeNull()
    expect(countryName('T1')).toBe('réseau Tor')
    expect(countryName('../')).toBeNull()
  })

  it('reads UTF-8 and %-encoded place names', () => {
    expect(headerText(Buffer.from('Auvergne-Rhône-Alpes', 'utf8').toString('latin1'))).toBe('Auvergne-Rhône-Alpes')
    expect(headerText('Saint-%C3%89tienne')).toBe('Saint-Étienne')
    expect(headerText('Lyon')).toBe('Lyon')
  })

  const req = (remote: string, raw: Record<string, string>, ip = remote) => {
    const headers = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]))
    return { socket: { remoteAddress: remote }, ip, headers, get: (h: string) => headers[h.toLowerCase()] } as unknown as Request
  }

  const CF = { 'cf-connecting-ip': '203.0.113.7', 'cf-ipcountry': 'FR', 'cf-ipcity': 'Lyon', 'cf-region': 'Auvergne-Rhône-Alpes', 'User-Agent': UA.iphone }

  it('believes Cloudflare only through the tunnel (a request from this machine)', () => {
    expect(clientInfo(req('127.0.0.1', CF))).toEqual({
      ip: '203.0.113.7', userAgent: UA.iphone, device: 'iPhone · Safari', location: 'Lyon, Auvergne-Rhône-Alpes, France',
    })
    // Someone on the network cannot fake where they are
    expect(clientInfo(req('::ffff:198.51.100.4', CF))).toMatchObject({ ip: '198.51.100.4', location: null })
    // On the local network
    expect(clientInfo(req('192.168.1.20', { 'User-Agent': UA.mac }))).toMatchObject({ ip: '192.168.1.20', location: 'Réseau local', device: 'Mac · Safari' })
    // Country only (visitor location headers off)
    expect(clientInfo(req('127.0.0.1', { 'cf-connecting-ip': '203.0.113.9', 'cf-ipcountry': 'CA' })).location).toBe('Canada')
  })
})
