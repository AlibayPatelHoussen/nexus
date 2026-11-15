/**
 * The server's time zone. Times of what happens on the server (when it started, sign-ins,
 * connected devices, account end dates, IPTV refreshes, files) are shown in it — the time
 * where the server is — whatever the zone of the device looking (an iPhone abroad).
 * Given by /api/health and remembered on this device, so it is known before the first answer.
 */
const KEY = 'nexus_server_tz'

function valid(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false
  try { new Intl.DateTimeFormat('fr-FR', { timeZone: tz }); return true } catch { return false }
}

let zone: string | undefined = (() => {
  try { const v = localStorage.getItem(KEY); return valid(v) ? v : undefined } catch { return undefined }
})()

/** The server's IANA time zone (« Europe/Paris »), undefined while unknown (the device's is used). */
export const serverTimeZone = (): string | undefined => zone

export function rememberServerTimeZone(tz: unknown) {
  if (!valid(tz) || tz === zone) return
  zone = tz
  try { localStorage.setItem(KEY, tz) } catch { /* private mode */ }
}

/** « 2026-11-15 »: the day of an instant in a time zone. */
export function dayKey(d: Date, tz = serverTimeZone()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Days from one day key to another (« 2026-11-14 » → « 2026-11-15 » = 1). */
export function daysBetween(from: string, to: string): number {
  const utc = (k: string) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((utc(to) - utc(from)) / 86_400_000)
}

/** The day key `n` days after `key`. */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** How far a time zone is ahead of UTC at an instant, in ms. */
function offsetMs(at: Date, tz?: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(at).map((x) => [x.type, Number(x.value)]))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000
}

/** The instant of a wall-clock time in a time zone (« 2027-06-30 23:59:59 » at the server). */
export function zonedInstant(day: string, h: number, mi: number, s: number, tz = serverTimeZone()): Date {
  const [y, m, d] = day.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi, s)
  let t = guess - offsetMs(new Date(guess), tz)
  const again = guess - offsetMs(new Date(t), tz)      // the offset may change on that very day (summer time)
  if (again !== t) t = again
  return new Date(t)
}
