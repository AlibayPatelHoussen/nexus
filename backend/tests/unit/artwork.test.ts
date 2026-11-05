jest.mock('../../src/config/database', () => ({ query: jest.fn() }))
import { pickArtwork } from '../../src/services/artwork'

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

  it('prefers a French logo, then English, never an SVG', () => {
    expect(pickArtwork({ logos: [img('/en.png', 'en', 9), img('/fr.png', 'fr', 3), img('/fr.svg', 'fr', 10)] }).logo).toMatch(/\/fr\.png$/)
    expect(pickArtwork({ logos: [img('/en.png', 'en'), img('/de.png', 'de', 9)] }).logo).toMatch(/\/en\.png$/)
    expect(pickArtwork({ logos: [img('/only.svg', 'fr')] }).logo).toBeNull()
  })

  it('returns nulls when TMDB has nothing', () => {
    expect(pickArtwork({})).toEqual({ keyArt: null, logo: null, backdrop: null })
  })
})
