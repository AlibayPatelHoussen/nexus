import { describe, it, expect } from 'vitest'
import { formatBytes, formatUptime, formatDuration, getFileIcon, cn } from '@/utils'

describe('formatBytes', () => {
  it('returns 0 B for 0', () => expect(formatBytes(0)).toBe('0 B'))
  it('formats bytes', () => expect(formatBytes(1024)).toBe('1 KB'))
  it('formats megabytes', () => expect(formatBytes(1024 * 1024)).toBe('1 MB'))
  it('formats gigabytes', () => expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB'))
  it('handles terabytes', () => expect(formatBytes(1024 ** 4)).toBe('1 TB'))
})

describe('formatUptime', () => {
  it('formats minutes only', () => expect(formatUptime(300)).toBe('5m'))
  it('formats hours and minutes', () => expect(formatUptime(3661)).toBe('1h 1m'))
  it('formats days', () => expect(formatUptime(90061)).toBe('1j 1h 1m'))
})

describe('formatDuration', () => {
  it('formats mm:ss under an hour', () => expect(formatDuration(125)).toBe('2:05'))
  it('formats h:mm:ss over an hour', () => expect(formatDuration(3661)).toBe('1:01:01'))
  it('pads seconds', () => expect(formatDuration(65)).toBe('1:05'))
})

describe('getFileIcon', () => {
  it('returns folder icon for directories', () => {
    expect(getFileIcon(null, 'directory')).toBe('folder')
  })
  it('returns video icon for mkv', () => {
    expect(getFileIcon('.mkv', 'file')).toBe('file-video')
  })
  it('returns code icon for py', () => {
    expect(getFileIcon('.py', 'file')).toBe('file-code-2')
  })
  it('returns generic file icon for unknown', () => {
    expect(getFileIcon('.xyz', 'file')).toBe('file')
  })
})

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })
  it('handles conditional classes', () => {
    expect(cn('base', false && 'nope', 'yes')).toBe('base yes')
  })
  it('deduplicates tailwind classes', () => {
    expect(cn('p-4', 'p-6')).toBe('p-6')
  })
})
