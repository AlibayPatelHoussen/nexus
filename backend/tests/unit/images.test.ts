import { isAllowed, proxied, urlVersion } from '../../src/services/images'

describe('image proxy', () => {
  it.each([
    ['https://image.tmdb.org/t/p/w500/x.jpg', true],
    ['https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1.jpg', true],
    ['https://img.anilist.co/x.jpg', true],
    ['https://uploads.mangadex.org/covers/abc/file.jpg', true],
    ['https://evil.example.com/x.jpg', false],
    ['file:///etc/passwd', false],
    ['http://169.254.169.254/latest/meta-data', false],
  ])('%s allowed: %s', (url, ok) => {
    expect(isAllowed(url)).toBe(ok)
  })

  it('rewrites remote artwork to the proxy, keeps local/data URIs', () => {
    const url = 'https://s4.anilist.co/file/x.jpg'
    expect(proxied('media', 'id1', 'poster', url)).toBe(`/api/images/media/id1/poster?v=${urlVersion(url)}`)
    expect(proxied('episode', 'e1', 'thumb', url)).toBe(`/api/images/episode/e1?v=${urlVersion(url)}`)
    expect(proxied('media', 'id1', 'poster', 'data:image/png;base64,xx')).toBe('data:image/png;base64,xx')
    expect(proxied('media', 'id1', 'poster', null)).toBeNull()
  })

  it('version changes when the source URL changes', () => {
    expect(urlVersion('https://a/1.jpg')).not.toBe(urlVersion('https://a/2.jpg'))
  })
})
