import { query, db as pool } from '../config/database'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../utils/errors'

/**
 * « Mes chaînes » (IPTV › Paramètres, admins): channels the owner adds with their stream address
 * (an m3u8 link), one by one or several at once from an M3U list. Each is written into the
 * catalogue at once as « my-<id> » and shown like the other channels (in its country, first);
 * every refresh of the sources keeps it. Never checked in the background (a provider counts each
 * connection): only when it is opened.
 * The address may hold the account's credentials (…/live/user/password/119.m3u8): it stays on
 * the server, never sent to a browser (only its host), played through the relay like the rest.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_MY_CHANNELS = 2000
/** An M3U list pasted or chosen as a file (the request body may be that big: see index.ts) */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
export const myChannelId = (id: string) => `my-${id}`

interface MyRow { id: string; name: string; url: string; country: string | null; logo: string | null; position: number; created_at: Date }

const hostOf = (url: string) => { try { return new URL(url).host } catch { return null } }

function publicMine(r: MyRow) {
  return {
    id: r.id,
    /** Its id in the catalogue (favourites, player) */
    channelId: myChannelId(r.id),
    name: r.name,
    country: r.country,
    /** Only the host: the rest of the address may hold credentials */
    host: hostOf(r.url),
    createdAt: r.created_at,
  }
}
export type MyChannel = ReturnType<typeof publicMine>

// ─── Checks shared by one channel and a list ─────────────────────────────────
const KODI = /\[\/?(?:COLOR[^\]]*|B|I|U|UPPERCASE|LOWERCASE|CAPITALIZE|LIGHT|CR)\]/gi
const PREFIX = /^\|?\s*([A-Z]{2})\s*(?:\||-|:|»|►)\s*/
const VOD_PATH = /\/(?:movie|movies|series|vod)\//i
const VOD_FILE = /\.(?:mp4|mkv|avi|mov|wmv|flv|m4v|webm)$/i
const ADULT = /(?:^|\W)(?:xxx|adults?|18\+|porn\w*)(?:\W|$)/i
const regions = new Intl.DisplayNames(['fr'], { type: 'region' })

/** « [COLOR red]TF1[/COLOR]  HD » -> « TF1 HD » */
export const cleanName = (raw: string) => raw.replace(KODI, '').replace(/\s+/g, ' ').trim()

/** « fr », « FR », « GB », « UK » -> the code the catalogue uses (iptv-org says UK); null if none or unknown */
export function countryCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const code = raw.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return null
  const iso = code === 'UK' ? 'GB' : code
  // Not a country: no name, or a code left free for private use (ZZ « région indéterminée », XA…)
  if (regions.of(iso) === iso || /^(?:AA|ZZ|Q[M-Z]|X[A-JL-Z])$/.test(iso)) return null
  return code === 'GB' ? 'UK' : code
}

/** « FR - TF1 HD » -> { name: 'TF1 HD', country: 'FR' }; a prefix that is no country stays in the name */
export function splitCountry(name: string): { name: string; country: string | null } {
  const m = PREFIX.exec(name)
  const country = m ? countryCode(m[1]) : null
  if (!m || !country) return { name, country: null }
  return { name: name.slice(m[0].length).trim() || name, country }
}

type Refusal = 'address' | 'vod' | 'separator'
/** Why a stream address cannot be one of « Mes chaînes » (null: it can). */
function refusal(url: string): Refusal | null {
  // A separator's dummy address (http://0.1.5.0:1224, even with an impossible port): no real server
  if (/^https?:\/\/0\.\d+\.\d+\.\d+(?::\d+)?(?:[/?#]|$)/i.test(url)) return 'separator'
  let u: URL
  try { u = new URL(url) } catch { return 'address' }
  if (!/^https?:$/.test(u.protocol) || !u.hostname || url.length > 2048) return 'address'
  // Films / episodes on demand, DASH: not a live the player reads
  if (VOD_PATH.test(u.pathname) || VOD_FILE.test(u.pathname) || /\.mpd$/i.test(u.pathname)) return 'vod'
  return null
}

const webUrl = (v: unknown) => (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()) && v.trim().length <= 2048 ? v.trim() : null)

// ─── An M3U list ───────────────────────────────────────────────────────────────
export interface M3uEntry { name: string; url: string; attrs: Record<string, string> }

/** The entries of an M3U list (#EXTINF + address); other lines and protocols are skipped. */
export function parseM3u(text: string): M3uEntry[] {
  const out: M3uEntry[] = []
  let pending: { attrs: Record<string, string>; name: string } | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^\uFEFF/, '')
    if (!line) continue
    if (/^#EXTINF/i.test(line)) {
      const body = line.slice(line.indexOf(':') + 1)
      // The name follows the first comma outside quotes (it may hold commas itself)
      let inQuotes = false
      let cut = -1
      for (let i = 0; i < body.length && cut < 0; i++) {
        if (body[i] === '"') inQuotes = !inQuotes
        else if (body[i] === ',' && !inQuotes) cut = i
      }
      const head = cut >= 0 ? body.slice(0, cut) : body
      const attrs: Record<string, string> = {}
      for (const m of head.matchAll(/([A-Za-z0-9_-]+)="([^"]*)"/g)) attrs[m[1].toLowerCase()] = m[2].trim()
      pending = { attrs, name: cut >= 0 ? body.slice(cut + 1).trim() : '' }
      continue
    }
    if (line.startsWith('#')) continue
    if (!/^https?:\/\//i.test(line)) { pending = null; continue }
    out.push({ name: pending?.name ?? '', url: line, attrs: pending?.attrs ?? {} })
    pending = null
  }
  return out
}

// ─── Catalogue rows ────────────────────────────────────────────────────────────
type Run = (sql: string, params: unknown[]) => Promise<unknown>
async function writeChannels(rows: MyRow[], run: Run = (sql, params) => query(sql, params)) {
  if (!rows.length) return
  await run(
    `INSERT INTO iptv_channels (id, name, country, logo, streams, mine_rank, updated_at)
     SELECT x.id, x.name, x.country, x.logo, x.streams, x.mine_rank, NOW()
     FROM jsonb_to_recordset($1::jsonb) AS x(id text, name text, country text, logo text, streams jsonb, mine_rank int)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, country = EXCLUDED.country, logo = EXCLUDED.logo,
       streams = EXCLUDED.streams, mine_rank = EXCLUDED.mine_rank, updated_at = NOW()`,
    [JSON.stringify(rows.map((r) => ({
      id: myChannelId(r.id), name: r.name, country: r.country, logo: r.logo, mine_rank: r.position,
      streams: [{ url: r.url, title: r.name, source: 'mine' }],
    })))],
  )
}

async function nextPosition(): Promise<number> {
  const { rows } = await query<{ n: number | null; count: string }>('SELECT MAX(position) AS n, COUNT(*) AS count FROM iptv_my_channels')
  if (Number(rows[0].count) >= MAX_MY_CHANNELS) throw new ValidationError(`${MAX_MY_CHANNELS} chaînes au plus dans « Mes chaînes »`)
  return (rows[0].n ?? 0) + 1
}

// ─── API ───────────────────────────────────────────────────────────────────────
export async function listMine(): Promise<MyChannel[]> {
  const { rows } = await query<MyRow>('SELECT * FROM iptv_my_channels ORDER BY position, created_at')
  return rows.map(publicMine)
}

/** One channel: { name, url, country?, logo? }. */
export async function addMine(body: unknown): Promise<MyChannel> {
  const b = (body ?? {}) as Record<string, unknown>
  const typed = typeof b.name === 'string' ? cleanName(b.name) : ''
  if (!typed || typed.length > 80) throw new ValidationError('Donne un nom à la chaîne (80 caractères au plus)')
  const url = typeof b.url === 'string' ? b.url.trim() : ''
  const why = refusal(url)
  if (why === 'address') throw new ValidationError('Lien du flux invalide (une adresse http:// ou https://, par exemple …/index.m3u8)')
  if (why === 'vod') throw new ValidationError('Ce lien est un film ou un épisode à la demande, pas une chaîne en direct')
  if (why === 'separator') throw new ValidationError('Ce lien ne mène à aucun serveur (un séparateur de liste)')
  if (b.country != null && b.country !== '' && !countryCode(b.country)) throw new ValidationError('Pays inconnu (deux lettres, par exemple FR)')
  const { name, country: prefixed } = splitCountry(typed)
  const country = countryCode(b.country) ?? prefixed
  const logo = webUrl(b.logo)
  if (b.logo && !logo) throw new ValidationError('Logo invalide (une adresse http:// ou https://)')
  const exists = await query('SELECT 1 FROM iptv_my_channels WHERE url = $1', [url])
  if (exists.rows.length) throw new ConflictError('Ce lien est déjà dans « Mes chaînes »')
  const position = await nextPosition()
  const { rows } = await query<MyRow>(
    'INSERT INTO iptv_my_channels (name, url, country, logo, position) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [name, url, country, logo, position])
  await writeChannels(rows)
  return publicMine(rows[0])
}

export interface ImportResult {
  added: number
  /** What was left out, and why */
  skipped: { duplicates: number; vod: number; separators: number; unnamed: number; adult: number; invalid: number; overLimit: number }
}

/** Several channels from an M3U list (pasted or a file): its live entries, in its order. */
export async function importMine(body: unknown): Promise<ImportResult> {
  const content = typeof (body as { content?: unknown })?.content === 'string' ? (body as { content: string }).content : ''
  if (!content.trim()) throw new ValidationError('Colle une liste M3U ou choisis un fichier')
  if (Buffer.byteLength(content, 'utf8') > MAX_IMPORT_BYTES) throw new AppError('Liste trop grosse (10 Mo au plus)', 413)
  const entries = parseM3u(content)
  if (!entries.length) throw new ValidationError('Aucun lien de flux dans cette liste (des lignes #EXTINF suivies de leur adresse http)')

  const skipped: ImportResult['skipped'] = { duplicates: 0, vod: 0, separators: 0, unnamed: 0, adult: 0, invalid: 0, overLimit: 0 }
  const known = new Set((await query<{ url: string }>('SELECT url FROM iptv_my_channels')).rows.map((r) => r.url))
  const kept: Omit<MyRow, 'id' | 'position' | 'created_at'>[] = []
  for (const e of entries) {
    const why = refusal(e.url)
    if (why === 'separator') { skipped.separators++; continue }
    if (why === 'vod') { skipped.vod++; continue }
    if (why) { skipped.invalid++; continue }
    const raw = cleanName(e.name || e.attrs['tvg-name'] || '')
    if (!raw) { skipped.unnamed++; continue }
    if (ADULT.test(raw) || ADULT.test(e.attrs['group-title'] ?? '')) { skipped.adult++; continue }
    if (known.has(e.url)) { skipped.duplicates++; continue }
    known.add(e.url)
    const { name, country: prefixed } = splitCountry(raw)
    kept.push({ name: name.slice(0, 80), url: e.url, country: countryCode(e.attrs['tvg-country']) ?? prefixed, logo: webUrl(e.attrs['tvg-logo']) })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // One import at a time: positions and the limit stay right
    await client.query('LOCK TABLE iptv_my_channels IN EXCLUSIVE MODE')
    const { rows: [state] } = await client.query<{ n: number | null; count: string }>('SELECT MAX(position) AS n, COUNT(*) AS count FROM iptv_my_channels')
    const room = Math.max(0, MAX_MY_CHANNELS - Number(state.count))
    skipped.overLimit = Math.max(0, kept.length - room)
    const take = kept.slice(0, room)
    let rows: MyRow[] = []
    if (take.length) {
      const first = (state.n ?? 0) + 1
      ;({ rows } = await client.query<MyRow>(
        `INSERT INTO iptv_my_channels (name, url, country, logo, position)
         SELECT x.name, x.url, x.country, x.logo, x.position
         FROM jsonb_to_recordset($1::jsonb) AS x(name text, url text, country text, logo text, position int)
         ON CONFLICT (url) DO NOTHING RETURNING *`,
        [JSON.stringify(take.map((c, i) => ({ ...c, position: first + i })))]))
      await writeChannels(rows, (sql, params) => client.query(sql, params))
    }
    await client.query('COMMIT')
    return { added: rows.length, skipped }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function removeMine(id: string): Promise<void> {
  if (!UUID.test(id)) throw new NotFoundError('Chaîne')
  const { rowCount } = await query('DELETE FROM iptv_my_channels WHERE id = $1', [id])
  if (!rowCount) throw new NotFoundError('Chaîne')
  // Its favourites stay (no foreign key), like any channel that leaves the catalogue
  await query('DELETE FROM iptv_channels WHERE id = $1', [myChannelId(id)])
}
