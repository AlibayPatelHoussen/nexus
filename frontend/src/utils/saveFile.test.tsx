import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const custom = vi.fn()
vi.mock('react-hot-toast', () => ({ default: { custom: (...a: unknown[]) => custom(...a), dismiss: vi.fn(), error: vi.fn() } }))

import { SHARE_MAX_BYTES, saveFile, typeOf } from './saveFile'

/** A server answering every request with these bytes */
class FakeXhr {
  status = 0
  response: Blob | null = null
  responseType = ''
  onload: (() => void) | null = null
  onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  url = ''
  open(_m: string, url: string) { this.url = url }
  send() { setTimeout(() => { this.status = 200; this.response = new Blob(['photo-bytes']); this.onload?.() }, 0) }
  abort() { this.onabort?.() }
}

const readText = (f: Blob) => new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsText(f) })

const nav = navigator as Navigator & { standalone?: boolean }
let share: ReturnType<typeof vi.fn>
beforeEach(() => {
  custom.mockReset()
  share = vi.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { share, canShare: () => true })
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
})
afterEach(() => {
  delete nav.standalone
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('typeOf', () => {
  it('the given type, else from the name (Photos for an image or a video)', () => {
    expect(typeOf('a.HEIC')).toBe('image/heic')
    expect(typeOf('clip.mov', 'application/octet-stream')).toBe('video/quicktime')
    expect(typeOf('x.bin')).toBe('application/octet-stream')
    expect(typeOf('x.jpg', 'image/png')).toBe('image/png')
  })
})

describe('saveFile', () => {
  it('a browser: downloaded in place, no new page', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    saveFile({ url: '/api/transfers/1/file?token=t', name: 'Photo été.jpg', size: 10 })
    expect(click).toHaveBeenCalledTimes(1)
    const a = click.mock.instances[0] as unknown as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('/api/transfers/1/file?token=t')
    expect(a.download).toBe('Photo été.jpg')
    expect(open).not.toHaveBeenCalled()
  })

  it('the app from the home screen: fetched, then the share sheet with the file, its name and type', async () => {
    nav.standalone = true
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    saveFile({ url: '/api/transfers/1/file?token=t', name: 'Photo été.jpg', size: 11, type: 'image/jpeg' })
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const file = (share.mock.calls[0][0] as { files: File[] }).files[0]
    expect(file.name).toBe('Photo été.jpg')
    expect(file.type).toBe('image/jpeg')
    expect(await readText(file)).toBe('photo-bytes')
    expect(open).not.toHaveBeenCalled()
  })

  it('too big to hold, or no size known (.zip): the in-app browser sheet with the real link, never about:blank', () => {
    nav.standalone = true
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    saveFile({ url: '/api/files/download?path=%2Ffilm.mkv&token=t', name: 'film.mkv', size: SHARE_MAX_BYTES + 1 })
    saveFile({ url: '/api/files/zip?dir=%2Fa&token=t', name: 'a.zip', size: null })
    expect(open.mock.calls.map((c) => c[0])).toEqual(['/api/files/download?path=%2Ffilm.mkv&token=t', '/api/files/zip?dir=%2Fa&token=t'])
    expect(share).not.toHaveBeenCalled()
  })

  it('the tap\'s permission ran out while it came: « Enregistrer… » asks for one more tap', async () => {
    nav.standalone = true
    share.mockRejectedValueOnce(new DOMException('no gesture', 'NotAllowedError'))
    saveFile({ url: '/u?token=t', name: 'doc.pdf', size: 11 })
    await vi.waitFor(() => expect(custom.mock.calls.some((c) => (c[1] as { id?: string })?.id === 'ready-doc.pdf')).toBe(true))
  })
})
