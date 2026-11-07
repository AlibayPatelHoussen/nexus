import path from 'path'
import { chapterVersion } from '../../src/services/chapters'
import { langLabel } from '../../src/services/downloadScripts'

const root = path.join('/media/scans', 'One Piece')
const at = (...p: string[]) => path.join(root, ...p)

describe('chapter versions (VF, VOSTFR, VF Noir et blanc…)', () => {
  it('is the version folder the downloads use', () => {
    expect(chapterVersion(root, at('VF', 'Chapitre 1.pdf'))).toBe('VF')
    expect(chapterVersion(root, at('VOSTFR', 'Chapitre 1'))).toBe('VOSTFR')
    expect(chapterVersion(root, at('VF Noir et blanc', 'Chapitre 1.pdf'))).toBe('VF Noir et blanc')
    expect(chapterVersion(root, at('VF'))).toBe('VF')                     // images right in « VF »
  })

  it('is null for other layouts', () => {
    expect(chapterVersion(root, at('Chapitre 1.pdf'))).toBeNull()
    expect(chapterVersion(root, at('Tome 1', 'Chapitre 1'))).toBeNull()
    expect(chapterVersion(root, at('Vfx', 'Chapitre 1'))).toBeNull()
    expect(chapterVersion(root, root)).toBeNull()
  })

  it('labels the edition codes of the downloads', () => {
    expect(langLabel('VFNB')).toBe('VF noir et blanc')
    expect(langLabel('VOSTFRCO')).toBe('VOSTFR couleur')
    expect(langLabel('VOSTFR')).toBe('VOSTFR')
  })
})
