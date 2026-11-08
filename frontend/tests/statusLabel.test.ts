import { describe, expect, it } from 'vitest'
import { formatBytes, statusLabel } from '@/utils'

describe('statusLabel', () => {
  it('translates MangaDex, AniList and TMDB statuses', () => {
    expect(statusLabel('ongoing')).toBe('En cours')
    expect(statusLabel('RELEASING')).toBe('En cours')
    expect(statusLabel('Returning Series')).toBe('En cours')
    expect(statusLabel('FINISHED')).toBe('Terminé')
    expect(statusLabel('hiatus')).toBe('En pause')
    expect(statusLabel('Quelque chose')).toBe('Quelque chose')
  })
})

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(2.5 * 1024 ** 3)).toMatch(/^2,5\s?Go$/)
  })
})
