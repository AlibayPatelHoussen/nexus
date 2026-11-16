import { query } from '../config/database'
import { AppError, NotFoundError, ValidationError } from '../utils/errors'

/**
 * Playlists added in Nexus (IPTV › Paramètres, admins): the owner's own M3U lists, by address or
 * as a file, kept in the database of this server only (never on GitHub). Their live channels
 * join the catalogue at each refresh (downloaders/iptv/playlists.py).
 * An address often holds the account's credentials (…/get.php?username=…&password=…): it is
 * never sent back to a browser, only its host; the Python module gets it through a private file.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_PLAYLISTS = 10
/** A file's content (the request body may be bigger than the rest of the API's: see index.ts) */
export const MAX_CONTENT_BYTES = 10 * 1024 * 1024

interface PlaylistRow {
  id: string; name: string; url: string | null; content: string | null; created_at: Date
  refreshed_at: Date | null; channels: number | null; error: string | null
}

const hostOf = (url: string | null) => { try { return url ? new URL(url).host : null } catch { return null } }

function publicPlaylist(r: Omit<PlaylistRow, 'content'> & { has_content?: boolean }) {
  return {
    id: r.id,
    name: r.name,
    /** 'url': read from its address at each refresh; 'file': the content given once */
    kind: r.url ? 'url' as const : 'file' as const,
    /** Only the host: the rest of an address may hold credentials */
    host: hostOf(r.url),
    createdAt: r.created_at,
    refreshedAt: r.refreshed_at,
    channels: r.channels,
    error: r.error,
  }
}
export type PublicPlaylist = ReturnType<typeof publicPlaylist>

export async function listPlaylists(): Promise<PublicPlaylist[]> {
  const { rows } = await query<PlaylistRow>(
    'SELECT id, name, url, created_at, refreshed_at, channels, error FROM iptv_playlists ORDER BY created_at, id')
  return rows.map(publicPlaylist)
}

/** What the playlists' channel lists are called (filters, home shelves): for every IPTV account */
export async function playlistNames(): Promise<{ id: string; name: string; count: number }[]> {
  const { rows } = await query<{ id: string; name: string; count: string }>(
    `SELECT p.id, p.name, COUNT(c.id) AS count FROM iptv_playlists p
     LEFT JOIN iptv_channels c ON c.playlist = p.id GROUP BY p.id ORDER BY p.created_at, p.id`)
  return rows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) }))
}

export async function addPlaylist(body: unknown): Promise<PublicPlaylist> {
  const b = (body ?? {}) as { name?: unknown; url?: unknown; content?: unknown }
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : ''
  if (!name || name.length > 60) throw new ValidationError('Donne un nom à la playlist (60 caractères au plus)')
  const hasUrl = typeof b.url === 'string' && b.url.trim() !== ''
  const hasContent = typeof b.content === 'string' && b.content.trim() !== ''
  if (hasUrl === hasContent) throw new ValidationError('Donne l’adresse de la playlist ou son fichier (l’un ou l’autre)')

  let url: string | null = null
  let content: string | null = null
  if (hasUrl) {
    const raw = (b.url as string).trim()
    let parsed: URL
    try { parsed = new URL(raw) } catch { throw new ValidationError('Adresse de playlist invalide') }
    if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname || raw.length > 2048) {
      throw new ValidationError('Adresse de playlist invalide (http ou https)')
    }
    url = parsed.toString()
  } else {
    content = (b.content as string).replace(/\r\n?/g, '\n')
    if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) throw new AppError('Fichier trop gros (10 Mo au plus)', 413)
    if (!/#EXTINF/i.test(content) && !/^\s*https?:\/\//im.test(content)) {
      throw new ValidationError('Ce fichier n’est pas une playlist M3U (aucune ligne #EXTINF)')
    }
  }
  const { rows: count } = await query<{ n: string }>('SELECT COUNT(*) AS n FROM iptv_playlists')
  if (Number(count[0].n) >= MAX_PLAYLISTS) throw new ValidationError(`${MAX_PLAYLISTS} playlists au plus`)
  const { rows } = await query<PlaylistRow>(
    `INSERT INTO iptv_playlists (name, url, content) VALUES ($1, $2, $3)
     RETURNING id, name, url, created_at, refreshed_at, channels, error`, [name, url, content])
  return publicPlaylist(rows[0])
}

export async function removePlaylist(id: string): Promise<void> {
  if (!UUID.test(id)) throw new NotFoundError('Playlist')
  const { rowCount } = await query('DELETE FROM iptv_playlists WHERE id = $1', [id])
  if (!rowCount) throw new NotFoundError('Playlist')
}

/** What the Python module reads (written to a private file, never on its command line). */
export async function playlistsForRefresh(): Promise<{ id: string; url?: string; content?: string }[]> {
  const { rows } = await query<PlaylistRow>('SELECT id, url, content FROM iptv_playlists ORDER BY created_at, id')
  return rows.map((r) => (r.url ? { id: r.id, url: r.url } : { id: r.id, content: r.content ?? '' }))
}

/** Each playlist's result after a refresh: its channel count, or why it could not be read. */
export async function savePlaylistResults(results: unknown): Promise<void> {
  if (!Array.isArray(results)) return
  for (const r of results as { id?: unknown; channels?: unknown; error?: unknown }[]) {
    if (typeof r?.id !== 'string' || !UUID.test(r.id)) continue
    const channels = Number.isInteger(r.channels) ? (r.channels as number) : 0
    const error = typeof r.error === 'string' && r.error ? r.error.slice(0, 300) : null
    await query('UPDATE iptv_playlists SET refreshed_at = NOW(), channels = $2, error = $3 WHERE id = $1', [r.id, channels, error])
  }
}
