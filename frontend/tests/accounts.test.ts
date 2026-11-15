import { describe, expect, it } from 'vitest'
import { formatWhen } from '@/utils'
import { endOf, endOfDay, firstEndDay } from '@/services/usersService'

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

describe('an end day of your choice', () => {
  const now = new Date(2026, 10, 15, 18, 30)
  it('ends that day at 23:59 local time, never today or before', () => {
    expect(firstEndDay(now)).toBe('2026-11-16')
    const end = new Date(endOfDay('2027-03-01', now)!)
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours(), end.getMinutes()]).toEqual([2027, 2, 1, 23, 59])
    expect(endOfDay('2026-11-15', now)).toBeNull()
    expect(endOfDay('2026-11-16', now)).not.toBeNull()
    expect(endOfDay('', now)).toBeNull()
    expect(endOfDay('demain', now)).toBeNull()
  })
})

describe('times at the server, whatever the zone of the device', () => {
  const started = '2026-11-15T10:17:00Z'
  const now = new Date('2026-11-15T18:30:00Z')
  it('shows the server\'s hour', async () => {
    const { formatDateTime, formatWhen } = await import('@/utils')
    expect(formatDateTime(started, 'medium', 'Europe/Paris')).toMatch(/11:17/)
    expect(formatDateTime(started, 'medium', 'America/Toronto')).toMatch(/05:17/)
    expect(formatWhen(started, now, 'Europe/Paris')).toBe('aujourd’hui à 11:17')
    expect(formatWhen(started, now, 'America/Toronto')).toBe('aujourd’hui à 05:17')
    // 00:30 in Paris is still « yesterday » in Toronto
    expect(formatWhen('2026-11-14T23:30:00Z', now, 'Europe/Paris')).toBe('aujourd’hui à 00:30')
    expect(formatWhen('2026-11-14T23:30:00Z', now, 'America/Toronto')).toBe('hier à 18:30')
  })

  it('an account ends at 23:59 at the server, summer time included', () => {
    expect(endOfDay('2027-06-30', now, 'Europe/Paris')).toBe('2027-06-30T21:59:59.000Z')
    expect(endOfDay('2027-06-30', now, 'America/Toronto')).toBe('2027-07-01T03:59:59.000Z')
    expect(endOfDay('2027-01-15', now, 'Europe/Paris')).toBe('2027-01-15T22:59:59.000Z')
    expect(endOfDay('2027-03-28', now, 'Europe/Paris')).toBe('2027-03-28T21:59:59.000Z')    // the day summer time starts
    // Already the 16th in Paris at 23:30 UTC on the 15th: the first possible end day is the 17th
    expect(firstEndDay(new Date('2026-11-15T23:30:00Z'), 'Europe/Paris')).toBe('2026-11-17')
    expect(firstEndDay(new Date('2026-11-15T23:30:00Z'), 'America/Toronto')).toBe('2026-11-16')
  })
})
