import type { Terminal } from '@xterm/xterm'

/** The last web address on screen (a wrapped one joined back), for the « Ouvrir » capsule: a long
 *  link spread over several rows cannot be tapped in the terminal on a touch screen */
/** The server's own addresses: they never open from another device (127.0.0.1 is the phone itself) */
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$/i

export function lastLinkOnScreen(term: Pick<Terminal, 'rows' | 'buffer'>): string | null {
  const buf = term.buffer.active
  const end = Math.min(buf.length, buf.viewportY + term.rows)
  let y = buf.viewportY
  while (y > 0 && buf.getLine(y)?.isWrapped) y--
  let found: string | null = null
  let text = ''
  const take = () => {
    for (const m of text.matchAll(/https?:\/\/[^\s"'<>`«»]+/g)) {
      const url = m[0].replace(/[.,;:!?)\]]+$/, '')
      try {
        const u = new URL(url)
        if (/^https?:$/.test(u.protocol) && !LOOPBACK.test(u.hostname)) found = url
      } catch { /* not an address */ }
    }
    text = ''
  }
  for (; y < buf.length; y++) {
    const line = buf.getLine(y)
    if (!line) break
    if (!line.isWrapped) { take(); if (y >= end) break }
    text += line.translateToString(true)
  }
  take()
  return found
}
