import { isPartialDownload } from '../../src/services/scanner'

describe('yt-dlp intermediate files are not videos', () => {
  it.each([
    ['LE JEU DU BLUFF (Avec Anyme) [TS93delvy8U].f251.webm', true],
    ['LE JEU DU BLUFF (Avec Anyme) [TS93delvy8U].f399.mp4', true],
    ['LE JEU DU BLUFF (Avec Anyme) [TS93delvy8U].temp.mp4', true],
    ['Clip [abc].f137-drc.mp4', true],
    ['clip.mp4.part', true],
    ['LE JEU DU BLUFF (Avec Anyme) [TS93delvy8U].mp4', false],
    ['Episode 3.mkv', false],
    ['The.Office.S01E02.720p.mkv', false],
  ])('%s → %s', (name, partial) => {
    expect(isPartialDownload(name)).toBe(partial)
  })
})
