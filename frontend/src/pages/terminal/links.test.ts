import { describe, expect, it } from 'vitest'
import { lastLinkOnScreen } from './links'

/** A terminal buffer of `cols` columns, as xterm keeps it: long lines wrapped onto several rows */
function term(lines: string[], cols: number, rows: number, viewportY?: number) {
  const out: { text: string; isWrapped: boolean }[] = []
  for (const l of lines) {
    if (!l) { out.push({ text: '', isWrapped: false }); continue }
    for (let i = 0; i < l.length; i += cols) out.push({ text: l.slice(i, i + cols), isWrapped: i > 0 })
  }
  const top = viewportY ?? Math.max(0, out.length - rows)
  return {
    rows,
    buffer: { active: {
      length: out.length, viewportY: top,
      getLine: (y: number) => out[y] && { isWrapped: out[y].isWrapped, translateToString: () => out[y].text.trimEnd() },
    } },
  } as unknown as Parameters<typeof lastLinkOnScreen>[0]
}

const GOOGLE = 'https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=202264815644.apps.googleusercontent.com' +
  '&redirect_uri=http%3A%2F%2F127.0.0.1%3A53682%2F&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file&state=abc'

describe('lastLinkOnScreen', () => {
  it('joins a long link spread over many rows (phone width), never a piece of it', () => {
    for (const cols of [38, 41, 45, 52]) {
      const t = term(['1. Ouvre ce lien :', '', GOOGLE, '', '2. Colle l’adresse ici.', 'Adresse : '], cols, 20)
      expect(lastLinkOnScreen(t)).toBe(GOOGLE)
    }
  })

  it('the last address on screen; none when it scrolled away', () => {
    const t = term(['voir https://example.com/a.', 'puis https://nexus.example/b)', 'fin'], 80, 3)
    expect(lastLinkOnScreen(t)).toBe('https://nexus.example/b')
    const scrolled = term([GOOGLE, ...Array.from({ length: 30 }, (_, i) => `ligne ${i}`)], 45, 10)
    expect(lastLinkOnScreen(scrolled)).toBeNull()
  })

  it('a link whose first rows are above the screen is still whole', () => {
    const lines = ['x', GOOGLE, 'Adresse : ']
    const t = term(lines, 45, 3, 4)
    expect(lastLinkOnScreen(t)).toBe(GOOGLE)
  })

  it('never the server\'s own addresses (127.0.0.1 opened on a phone is the phone)', () => {
    const t = term([GOOGLE, 'Adresse : x', '   elle commence par http://127.0.0.1:53682/?state=…', 'http://localhost:3001/ http://[::1]:80/'], 45, 30)
    expect(lastLinkOnScreen(t)).toBe(GOOGLE)
  })

  it('only http and https', () => {
    expect(lastLinkOnScreen(term(['file:///etc/passwd ftp://x javascript:alert(1)'], 80, 5))).toBeNull()
  })
})
