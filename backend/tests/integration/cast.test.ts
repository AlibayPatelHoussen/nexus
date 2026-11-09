import fs from 'fs'
import http from 'http'
import path from 'path'
import { AddressInfo } from 'net'
import request from 'supertest'
import { app } from '../../src/index'
import { makeToken } from '../helpers'
import { forgetDevices, parseDescription, parseSsdp, probeLocation } from '../../src/services/cast'

const user = { Authorization: `Bearer ${makeToken('user')}` }
const FILE = path.join(process.env.MEDIA_ROOT!, 'cast', 'Film (2020).mkv')

/** A fake TV: answers its description and records the commands it gets. */
function fakeTv(description: (base: string) => string, answer: (req: http.IncomingMessage, body: string) => string = () => '') {
  const calls: { method: string; url: string; action: string; body: string }[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      calls.push({ method: req.method!, url: req.url!, action: String(req.headers.soapaction ?? ''), body })
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      res.end(req.url === '/desc.xml' || req.url === '/' ? description(base) : answer(req, body))
    })
  })
  return new Promise<{ base: string; calls: typeof calls; close: () => void }>((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, close: () => server.close() })
  }))
}

const DLNA = () => `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device>
  <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>TV du salon</friendlyName>
  <modelName>UE55</modelName><UDN>uuid:tv-1</UDN><serviceList>
  <service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/rc</controlURL></service>
  <service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/upnp/control/AVTransport1</controlURL></service>
  </serviceList></device></root>`

beforeAll(() => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, 'x') })
afterAll(() => { fs.rmSync(path.dirname(FILE), { recursive: true, force: true }) })
beforeEach(() => forgetDevices())

describe('Cast to a TV (DLNA / Roku)', () => {
  it('reads SSDP answers and device descriptions', () => {
    expect(parseSsdp('HTTP/1.1 200 OK\r\nST: roku:ecp\r\nLOCATION: http://192.168.1.20:8060/\r\nUSN: uuid:roku:ecp:X1\r\n\r\n'))
      .toEqual({ location: 'http://192.168.1.20:8060/', usn: 'uuid:roku:ecp:X1' })
    expect(parseSsdp('NOTIFY * HTTP/1.1\r\nLOCATION: file:///etc/passwd\r\n')).toBeNull()
    const d = parseDescription(DLNA(), 'http://192.168.1.30:9197/desc.xml')
    expect(d).toMatchObject({ kind: 'dlna', name: 'TV du salon', url: 'http://192.168.1.30:9197/upnp/control/AVTransport1', host: '192.168.1.30' })
    expect(parseDescription('<root><device><friendlyName>Box</friendlyName></device></root>', 'http://1.2.3.4/')).toBeNull()
  })

  it('DLNA: the TV gets the stream URL, then play, pause, status', async () => {
    const tv = await fakeTv(DLNA, (req) => String(req.headers.soapaction).includes('GetTransportInfo')
      ? '<s:Envelope><s:Body><u:GetTransportInfoResponse><CurrentTransportState>PLAYING</CurrentTransportState></u:GetTransportInfoResponse></s:Body></s:Envelope>'
      : String(req.headers.soapaction).includes('GetPositionInfo')
        ? '<s:Envelope><s:Body><u:GetPositionInfoResponse><RelTime>0:01:05</RelTime><TrackDuration>1:30:00</TrackDuration></u:GetPositionInfoResponse></s:Body></s:Envelope>'
        : '<ok/>')
    try {
      const d = await probeLocation(`${tv.base}/desc.xml`)
      const list = await request(app).get('/api/cast/devices').set(user)
      expect(list.body.data).toEqual([{ id: d!.id, name: 'TV du salon', kind: 'dlna', model: 'UE55' }])

      const res = await request(app).post('/api/cast/play').set(user).send({ deviceId: d!.id, path: FILE, title: 'Film & co' })
      expect(res.status).toBe(200)
      const soap = tv.calls.filter((c) => c.method === 'POST')
      expect(soap.map((c) => c.action.split('#')[1]?.replace('"', ''))).toEqual(['Stop', 'SetAVTransportURI', 'Play'])
      expect(soap[0].url).toBe('/upnp/control/AVTransport1')
      const set = soap[1].body
      expect(set).toContain(`/api/files/stream?path=${encodeURIComponent(FILE)}`)
      expect(set).toMatch(/token=[\w.-]+/)
      expect(set).toContain('Film &amp;amp; co')          // DIDL inside SOAP: escaped twice
      expect(set).toContain('video/x-matroska')

      expect((await request(app).post('/api/cast/control').set(user).send({ deviceId: d!.id, action: 'pause' })).status).toBe(200)
      expect(tv.calls.at(-1)!.action).toContain('#Pause')
      await request(app).post('/api/cast/control').set(user).send({ deviceId: d!.id, action: 'seek', position: 3725 })
      expect(tv.calls.at(-1)!.body).toContain('<Target>1:02:05</Target>')
      const st = await request(app).get('/api/cast/status').set(user).query({ deviceId: d!.id })
      expect(st.body.data).toEqual({ state: 'playing', position: 65, duration: 5400 })
    } finally { tv.close() }
  })

  it('Roku: « Play on Roku » input with the URL, name from device-info', async () => {
    const tv = await fakeTv(() => '<root><device><deviceType>urn:roku-com:device:player:1-0</deviceType><friendlyName>Roku</friendlyName><serialNumber>X1</serialNumber></device></root>',
      (req) => req.url!.startsWith('/query/device-info') ? '<device-info><user-device-name>Roku chambre</user-device-name></device-info>'
        : req.url!.startsWith('/query/media-player') ? '<player error="false" state="pause"><position>5000 ms</position><duration>60000 ms</duration></player>' : '')
    try {
      const d = await probeLocation(`${tv.base}/`)
      expect(d).toMatchObject({ kind: 'roku', name: 'Roku chambre', id: 'roku:X1' })
      expect((await request(app).post('/api/cast/play').set(user).send({ deviceId: d!.id, path: FILE })).status).toBe(200)
      const input = tv.calls.find((c) => c.url.startsWith('/input/15985'))!
      const q = new URL(input.url, 'http://x').searchParams
      expect(input.method).toBe('POST')
      expect(q.get('t')).toBe('v')
      expect(q.get('videoFormat')).toBe('mkv')
      expect(q.get('u')).toMatch(/\/api\/files\/stream\?path=.+&token=/)

      // Paused: « play » presses Play once; « pause » presses nothing
      await request(app).post('/api/cast/control').set(user).send({ deviceId: d!.id, action: 'play' })
      await request(app).post('/api/cast/control').set(user).send({ deviceId: d!.id, action: 'pause' })
      expect(tv.calls.filter((c) => c.url === '/keypress/Play')).toHaveLength(1)
      expect((await request(app).post('/api/cast/control').set(user).send({ deviceId: d!.id, action: 'seek', position: 10 })).status).toBe(422)
    } finally { tv.close() }
  })

  it('Roku refusing network commands (« Contrôle par les applications mobiles »): says how to allow it', async () => {
    const refusing = http.createServer((req, res) => {
      if (req.url === '/') { res.end('<root><device><deviceType>urn:roku-com:device:player:1-0</deviceType><serialNumber>X3</serialNumber></device></root>'); return }
      res.statusCode = 403; res.end()
    })
    await new Promise<void>((r) => refusing.listen(0, '127.0.0.1', r))
    try {
      const d = await probeLocation(`http://127.0.0.1:${(refusing.address() as AddressInfo).port}/`)
      const res = await request(app).post('/api/cast/play').set(user).send({ deviceId: d!.id, path: FILE })
      expect(res.status).toBe(422)
      expect(res.body.error).toMatch(/Contrôle par les applications mobiles/)
      expect(res.body.error).toMatch(/AirPlay/)
    } finally { refusing.close() }
  })

  it('only discovered TVs, only library files, signed in', async () => {
    expect((await request(app).post('/api/cast/play').set(user).send({ deviceId: 'dlna:http://169.254.169.254/', path: FILE })).status).toBe(404)
    const tv = await fakeTv(DLNA)
    try {
      const d = await probeLocation(`${tv.base}/desc.xml`)
      expect((await request(app).post('/api/cast/play').set(user).send({ deviceId: d!.id, path: '/etc/passwd' })).status).toBe(403)
      expect(tv.calls.filter((c) => c.method === 'POST')).toHaveLength(0)
    } finally { tv.close() }
    expect((await request(app).get('/api/cast/devices')).status).toBe(401)
  })

  it('the stream answers DLNA TVs with their headers', async () => {
    const res = await request(app).get('/api/files/stream').set(user).query({ path: FILE }).set('getcontentFeatures.dlna.org', '1')
    expect(res.status).toBe(200)
    expect(res.headers['transfermode.dlna.org']).toBe('Streaming')
    expect(res.headers['contentfeatures.dlna.org']).toMatch(/DLNA\.ORG_OP=01/)
  })
})
