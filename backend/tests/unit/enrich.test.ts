jest.mock('../../src/config/database', () => ({ query: jest.fn() }))
jest.mock('../../src/services/artwork', () => ({ linkArtwork: jest.fn() }))
jest.mock('../../src/services/scanner', () => ({ linkAnimesToTmdb: jest.fn() }))

import { query } from '../../src/config/database'
import { linkArtwork } from '../../src/services/artwork'
import { linkAnimesToTmdb } from '../../src/services/scanner'
import { enrichNewTitles, syncImdb } from '../../src/services/imdb'

/*
 * A film downloaded through Nexus showed its poster with the title written on it and its name in
 * plain letters (owner's report, Harry Potter): the Apple TV artwork only came with the daily run.
 */
const artwork = linkArtwork as jest.Mock
beforeEach(() => {
  jest.clearAllMocks()
  ;(linkAnimesToTmdb as jest.Mock).mockResolvedValue(0)
  artwork.mockResolvedValue(1)
})

describe('enrichment of new titles', () => {
  it('the daily run still fetches the artwork when the IMDb dataset is unreachable', async () => {
    ;(query as jest.Mock).mockRejectedValue(new Error('database or network down'))
    const res = await syncImdb()
    expect(artwork).toHaveBeenCalledTimes(1)
    expect(res).toMatchObject({ artwork: 1, rated: 0 })
  })

  it('a title just added gets its artwork at once; asked during a run, it runs once more after it', async () => {
    ;(query as jest.Mock).mockResolvedValue({ rows: [] })
    let release!: () => void
    artwork.mockImplementationOnce(() => new Promise<number>((ok) => { release = () => ok(1) }))
    const first = enrichNewTitles()
    const second = enrichNewTitles()        // a second download finished meanwhile
    expect(second).toBe(first)
    await Promise.resolve()
    release()
    expect(await first).toBe(2)
    expect(artwork).toHaveBeenCalledTimes(2)
  })
})
