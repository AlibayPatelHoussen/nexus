import { describe, expect, it } from 'vitest'
import { chapterVersions, versionName } from '@/components/media/chapterVersions'

const ch = (...langs: (string | null)[]) => langs.map((language) => ({ language }))

describe('manga versions in the library', () => {
  it('lists the version folders, main version first', () => {
    expect(chapterVersions(ch('VF Noir et blanc', 'VF', 'VF', null))).toEqual(['VF', 'VF Noir et blanc'])
    expect(chapterVersions(ch('VOSTFR', 'VF'))).toEqual(['VF', 'VOSTFR'])
    expect(chapterVersions(ch(null, null))).toEqual([])
  })

  it('names colour / black & white editions like the download sheet', () => {
    const op = ['VF', 'VF Noir et blanc']
    expect(op.map((v) => versionName(v, op))).toEqual(['Couleur', 'Noir et blanc'])
    const two = ['VF', 'VF Noir et blanc', 'VOSTFR']
    expect(two.map((v) => versionName(v, two))).toEqual(['Couleur · VF', 'Noir et blanc · VF', 'Couleur · VOSTFR'])
    expect(['VF', 'VOSTFR'].map((v) => versionName(v, ['VF', 'VOSTFR']))).toEqual(['VF', 'VOSTFR'])
  })
})
