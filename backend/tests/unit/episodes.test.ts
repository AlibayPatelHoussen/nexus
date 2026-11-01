import { parseEpisodeInfo } from '../../src/services/scanner'

jest.mock('../../src/config/database', () => ({ query: jest.fn(), withTransaction: jest.fn() }))

describe('parseEpisodeInfo', () => {
  it.each([
    ['Georgie.and.Mandys.First.Marriage.S01E05.1080p.WEB.H264.mkv', [], 1, 5],
    ['show.s02.e10.mkv',                       [],               2, 10],
    ['Show S1 E3.mp4',                         [],               1, 3],
    ['Show 3x07 VOSTFR.avi',                   [],               3, 7],
    ['Episode 5.mkv',                          ['Saison 2'],     2, 5],
    ['Épisode 12.mp4',                         ['Season 01'],    1, 12],
    ['Ep 03.mkv',                              ['S04'],          4, 3],
    ['E07.mkv',                                ['Saison 3'],     3, 7],
    ['05.mkv',                                 ['Season 2'],     2, 5],
    ['Show - 12 [1080p] [x265].mkv',           [],               null, 12],
    ['Show 2024 - 08 (H.265 AAC 2.0).mkv',     [],               null, 8],
    ['The 100 S03E04.mkv',                     [],               3, 4],
    ['Bonus.mkv',                              ['Specials'],     0, null],
    ['Show 1920x1080 E02.mkv',                 ['Saison 1'],     1, 2],
  ] as [string, string[], number | null, number | null][])('%s (%j)', (file, folders, season, episode) => {
    expect(parseEpisodeInfo(file, folders)).toEqual({ season, episode })
  })

  it('uses the closest season folder', () => {
    expect(parseEpisodeInfo('E01.mkv', ['Saison 1', 'Season 2'])).toEqual({ season: 2, episode: 1 })
  })
})
