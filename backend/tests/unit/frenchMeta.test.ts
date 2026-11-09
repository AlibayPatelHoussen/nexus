import fs from 'fs'
import os from 'os'
import path from 'path'
import { catalogueSynopsis, tagFr } from '../../src/services/frenchMeta'
import { cleanMangaDexText } from '../../src/services/scanner'

describe('French metadata', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-fr-'))
  const before = process.env.DOWNLOADERS_DIR
  beforeAll(() => {
    process.env.DOWNLOADERS_DIR = dir
    fs.mkdirSync(path.join(dir, 'data'))
    fs.writeFileSync(path.join(dir, 'data', 'catalogue.json'), JSON.stringify([
      { title: 'L’Attaque des Titans', slug: 'shingeki-no-kyojin', description: 'L’humanité vit retranchée derrière de hauts murs pour échapper aux Titans.' },
      { title: 'Court', slug: 'court', description: 'Trop court.' },
    ]))
  })
  afterAll(() => {
    process.env.DOWNLOADERS_DIR = before
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('finds the anime-sama synopsis by title or slug', async () => {
    expect(await catalogueSynopsis('l attaque des titans')).toMatch(/^L’humanité/)
    expect(await catalogueSynopsis(null, 'Attack on Titan', 'Shingeki no Kyojin')).toMatch(/^L’humanité/)
    expect(await catalogueSynopsis('Court')).toBeNull()
    expect(await catalogueSynopsis('Inconnu')).toBeNull()
  })

  it('translates MangaDex tags, keeps unknown ones', () => {
    expect(['Adventure', 'Slice of Life', 'Brand New Tag'].map(tagFr)).toEqual(['Aventure', 'Tranche de vie', 'Brand New Tag'])
  })

  it('keeps the plain synopsis of a MangaDex description', () => {
    const md = 'Un **pirate** part à l’aventure.\n\n---\n**Liens :**\n- [Wikipédia](https://fr.wikipedia.org)'
    expect(cleanMangaDexText(md)).toBe('Un pirate part à l’aventure.')
    expect(cleanMangaDexText('Voir [ici](https://x.y) pour plus.')).toBe('Voir ici pour plus.')
    expect(cleanMangaDexText('')).toBeNull()
  })
})
