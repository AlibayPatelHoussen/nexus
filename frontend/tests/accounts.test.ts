import { describe, expect, it } from 'vitest'
import { formatWhen } from '@/utils'
import { endOf } from '@/services/usersService'

describe('when a device was last active', () => {
  const now = new Date(2026, 10, 15, 18, 30)
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
  it('reads like iOS', () => {
    expect(formatWhen(ago(20_000), now)).toBe('à l’instant')
    expect(formatWhen(ago(5 * 60_000), now)).toBe('il y a 5 min')
    expect(formatWhen(ago(3 * 3600_000), now)).toBe('il y a 3 h')
    expect(formatWhen(new Date(2026, 10, 15, 8, 5).toISOString(), now)).toBe('aujourd’hui à 08:05')
    expect(formatWhen(new Date(2026, 10, 14, 21, 4).toISOString(), now)).toBe('hier à 21:04')
    expect(formatWhen(new Date(2026, 10, 2, 10, 2).toISOString(), now)).toMatch(/^2 nov\.? à 10:02$/)
    expect(formatWhen(new Date(2025, 10, 2, 10, 2).toISOString(), now)).toMatch(/^2 nov\.? 2025$/)
  })
})

describe('account durations', () => {
  it('ends after the chosen months, none for « Sans limite »', () => {
    const from = new Date(2026, 10, 15, 12)
    expect(endOf('none', from)).toBeNull()
    expect(new Date(endOf('1y', from)!).getFullYear()).toBe(2027)
    expect(new Date(endOf('1y', from)!).getMonth()).toBe(10)
    expect(new Date(endOf('6m', from)!).getMonth()).toBe(4)
    expect(new Date(endOf('1m', from)!).getMonth()).toBe(11)
  })
})
