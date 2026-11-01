import { parseRange } from '../../src/routes/files'
import { parseChapterNumber } from '../../src/services/scanner'
import { clampLines } from '../../src/services/services'
import { verifyToken } from '../../src/middleware/auth'
import { makeToken } from '../helpers'

jest.mock('../../src/config/database', () => ({ query: jest.fn(), withTransaction: jest.fn() }))

describe('parseRange', () => {
  it.each([
    ['bytes=0-99',    { start: 0,   end: 99 }],
    ['bytes=100-',    { start: 100, end: 999 }],
    ['bytes=-100',    { start: 900, end: 999 }],
    ['bytes=900-5000', { start: 900, end: 999 }],
  ])('%s', (header, expected) => {
    expect(parseRange(header, 1000)).toEqual(expected)
  })

  it.each(['bytes=500-100', 'bytes=1000-', 'bytes=-0', 'bytes=-', 'items=0-1', 'bytes=abc'])(
    'rejects %s', (header) => expect(parseRange(header, 1000)).toBeNull(),
  )
})

describe('parseChapterNumber', () => {
  it.each([
    ['Chapter 12', 12],
    ['ch.12.5', 12.5],
    ['Chapitre_3', 3],
    ['Ch_7_5', 7.5],
    ['045', 45],
    ['Solo Leveling 110', 110],
    ['no number', 0],
  ])('%s → %d', (name, expected) => {
    expect(parseChapterNumber(name)).toBe(expected)
  })
})

describe('clampLines', () => {
  it('clamps to 1..1000 and falls back on NaN', () => {
    expect(clampLines(NaN, 50)).toBe(50)
    expect(clampLines(0, 50)).toBe(1)
    expect(clampLines(99999, 50)).toBe(1000)
    expect(clampLines(42.7, 50)).toBe(42)
  })
})

describe('verifyToken', () => {
  it('checks the token type', () => {
    expect(verifyToken(makeToken('admin', 'access'), 'access')?.role).toBe('admin')
    expect(verifyToken(makeToken('admin', 'stream'), 'access')).toBeNull()
    expect(verifyToken(makeToken('admin', 'access'), 'stream')).toBeNull()
    expect(verifyToken('garbage', 'access')).toBeNull()
  })
})
