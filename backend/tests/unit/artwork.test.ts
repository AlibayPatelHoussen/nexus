jest.mock('../../src/config/database', () => ({ query: jest.fn() }))
import sharp from 'sharp'
import { isTmdbOriginal, isTransparentLogo, logoCandidates, pickArtwork } from '../../src/services/artwork'

const img = (file_path: string, iso_639_1: string | null, vote_average = 5, width = 1000) => ({ file_path, iso_639_1, vote_average, vote_count: 10, width })

describe('pickArtwork (TMDB /images → Apple TV artwork)', () => {
  it('takes the best textless poster and backdrop, at full resolution', () => {
    const a = pickArtwork({
      posters:   [img('/fr.jpg', 'fr', 9), img('/clean-low.jpg', null, 4), img('/clean-best.jpg', null, 7)],
      backdrops: [img('/en.jpg', 'en', 9), img('/bg.jpg', null, 6)],
    })
    expect(a.keyArt).toMatch(/\/original\/clean-best\.jpg$/)
    expect(a.backdrop).toMatch(/\/original\/bg\.jpg$/)
  })

  it('prefers a French logo, then English, then textless; a PNG over an SVG; never another language', () => {
    expect(pickArtwork({ logos: [img('/en.png', 'en', 9), img('/fr.png', 'fr', 3), img('/fr.svg', 'fr', 10)] }).logo).toMatch(/\/fr\.png$/)
    expect(pickArtwork({ logos: [img('/en.png', 'en'), img('/de.png', 'de', 9)] }).logo).toMatch(/\/en\.png$/)
    expect(pickArtwork({ logos: [img('/only.svg', 'fr')] }).logo).toMatch(/\/only\.svg$/)
    expect(pickArtwork({ logos: [img('/ja.png', 'ja', 10)] }).logo).toBeNull()          // a Japanese promo logo: the title in text instead
    expect(pickArtwork({ logos: [img('/x.gif', 'fr')] }).logo).toBeNull()
    expect(logoCandidates([img('/n.png', null), img('/e.svg', 'en'), img('/f.svg', 'fr'), img('/e.png', 'en', 2)]).map((l) => l.file_path))
      .toEqual(['/f.svg', '/e.png', '/e.svg', '/n.png'])
  })

  it('key art: the best-rated textless poster (as before)', () => {
    const fan = { file_path: '/a.jpg', iso_639_1: null, vote_average: 6.5, vote_count: 2 }
    const other = { file_path: '/b.jpg', iso_639_1: null, vote_average: 6.2, vote_count: 40 }
    expect(pickArtwork({ posters: [other, fan] }).keyArt).toMatch(/\/a\.jpg$/)
  })

  it('a logo needs a transparent background (Bleach in a white box is not one)', async () => {
    const box = await sharp({ create: { width: 200, height: 60, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer()
    const logo = await sharp({ create: { width: 200, height: 60, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: { create: { width: 120, height: 30, channels: 4, background: { r: 220, g: 30, b: 30, alpha: 1 } } }, left: 40, top: 15 }]).png().toBuffer()
    const jpeg = await sharp(box).jpeg().toBuffer()
    expect(await isTransparentLogo(box)).toBe(false)
    expect(await isTransparentLogo(jpeg)).toBe(false)
    expect(await isTransparentLogo(logo)).toBe(true)
  })

  it('only original TMDB images can be chosen by hand', () => {
    expect(isTmdbOriginal('https://image.tmdb.org/t/p/original/abc_D-1.jpg')).toBe(true)
    expect(isTmdbOriginal('https://image.tmdb.org/t/p/original/logo.svg')).toBe(true)
    expect(isTmdbOriginal('https://image.tmdb.org/t/p/w500/abc.jpg')).toBe(false)
    expect(isTmdbOriginal('https://evil.example/t/p/original/abc.jpg')).toBe(false)
    expect(isTmdbOriginal('https://image.tmdb.org/t/p/original/../x.jpg')).toBe(false)
  })

  it('returns nulls when TMDB has nothing', () => {
    expect(pickArtwork({})).toEqual({ keyArt: null, logo: null, backdrop: null })
  })
})
