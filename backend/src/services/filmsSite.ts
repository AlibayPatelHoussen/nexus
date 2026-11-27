import fs from 'fs/promises'
import path from 'path'
import { collect, onScriptEnd, scriptsDir } from './downloadScripts'
import { query } from '../config/database'
import { sendPush, type PushMessage } from './push'
import { logger } from '../utils/logger'
import { ValidationError } from '../utils/errors'

/*
 * The films site (downloaders/films.py) moves from one domain to another. The script keeps the
 * address that works in downloaders/data/films_site.json and follows the site by itself when it
 * moves (redirect, « nouvelle adresse » page, the other addresses it showed). Réglages shows it,
 * and an admin can paste the new link when the script could not find it (tried first).
 */

export interface FilmsSite {
  url:      string
  host:     string
  /** Answering the last time the script tried (null: not tried yet) */
  ok:       boolean | null
  /** How the address was found: default (in the script), redirect / mirror (by itself), manual (Réglages) */
  how:      string | null
  /** When the address changed last, when the script last reached it */
  found:    string | null
  checked:  string | null
  previous: string | null
}

const siteFile = () => path.join(scriptsDir(), 'data', 'films_site.json')

async function readSaved(): Promise<Record<string, unknown>> {
  try {
    const data = JSON.parse(await fs.readFile(siteFile(), 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch { return {} }
}

/** The address written in the script (DEFAULT_SITE_URL) */
async function defaultUrl(): Promise<string | null> {
  try {
    const src = await fs.readFile(path.join(scriptsDir(), 'films.py'), 'utf8')
    return /^DEFAULT_SITE_URL\s*=\s*"([^"]+)"/m.exec(src)?.[1] ?? null
  } catch { return null }
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const hostOf = (u: string) => { try { return new URL(u).hostname } catch { return u } }

export async function filmsSite(): Promise<FilmsSite | null> {
  const saved = await readSaved()
  const url = str(saved.url) ?? await defaultUrl()
  if (!url) return null
  return {
    url, host: hostOf(url),
    ok: typeof saved.ok === 'boolean' ? saved.ok : null,
    how: str(saved.url) ? str(saved.how) : 'default',
    found: str(saved.found), checked: str(saved.checked), previous: str(saved.previous),
  }
}

/** « Site de films »: the link pasted by an admin (the script tries it first, then follows the site if it moved again) */
export async function setFilmsSite(raw: unknown): Promise<FilmsSite> {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 500) throw new ValidationError('Colle l’adresse du site')
  let text = raw.trim()
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`
  let url: URL
  try { url = new URL(text) } catch { throw new ValidationError('Adresse invalide') }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.') || url.username || url.password) {
    throw new ValidationError('Adresse invalide')
  }
  const saved = await readSaved()
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const next = {
    ...saved,
    url: url.toString(),
    how: 'manual',
    found: now,
    previous: str(saved.url) ?? await defaultUrl(),
  }
  const file = siteFile()
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(next, null, 2))
  await fs.rename(tmp, file)
  // Tried at once (the admins hear whether it works)
  void checkFilmsSite()
  return (await filmsSite())!
}

/* ── Notifications to the admins ──────────────────────────────────────────────
 * After each run of films.py (a search, a download, the check every 6 hours), the site's state
 * is compared with what the admins were told last (app_settings 'films_site'):
 *   - it stopped answering → « Site de films en panne », then « nouvelle adresse » (found by
 *     itself) or « à toi de jouer » (to paste in Réglages);
 *   - it answers again (a link pasted, the same address back) → « ça remarche ».
 */
const TOLD = 'films_site'
const where = '/settings'

export async function syncFilmsSite(): Promise<string[]> {
  const saved = await readSaved()
  const url = str(saved.url)
  if (typeof saved.ok !== 'boolean' || !url) return []        // not tried by the script yet
  const now = { url, ok: saved.ok }
  const { rows } = await query<{ value: { url?: string; ok?: boolean } }>('SELECT value FROM app_settings WHERE key = $1', [TOLD])
  const told = rows[0]?.value
  if (told && told.url === now.url && told.ok === now.ok) return []
  await query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [TOLD, JSON.stringify(now)])

  const host = hostOf(now.url)
  const down = (h: string): PushMessage => ({
    title: 'Site de films en panne', body: `${h} ne répond plus. Nexus cherche sa nouvelle adresse…`, url: where, tag: 'films-site-down',
  })
  const msgs: PushMessage[] = []
  if (!now.ok) {
    if (told?.ok !== false) {
      msgs.push(down(hostOf(told?.url ?? now.url)), {
        title: 'Site de films : à toi de jouer',
        body: 'Nexus n’a pas trouvé sa nouvelle adresse. Colle le nouveau lien dans Réglages › Bibliothèque › Site de films.',
        url: where, tag: 'films-site',
      })
    }
  } else if (told && told.url !== now.url && saved.how !== 'manual') {
    const lost = str(saved.lost)
    if (lost && told.ok !== false) msgs.push(down(hostOf(lost)))
    msgs.push({
      title: 'Site de films : nouvelle adresse',
      body: `Nexus est passé tout seul de ${hostOf(told.url ?? lost ?? now.url)} à ${host}. Rien à faire.`,
      url: where, tag: 'films-site',
    })
  } else if (told?.ok === false) {
    msgs.push({ title: 'Site de films : ça remarche', body: `${host} répond : les recherches de films reprennent.`, url: where, tag: 'films-site' })
  }
  if (msgs.length) {
    const admins = (await query<{ id: string }>(`SELECT id FROM users WHERE role = 'admin'`)).rows.map((r) => r.id)
    for (const m of msgs) await sendPush(admins, m)
    logger.info(`Films site: ${msgs.map((m) => m.title).join(' / ')}`)
  }
  return msgs.map((m) => m.title)
}

// After each run of films.py
onScriptEnd('films', () => { void syncFilmsSite().catch((err: Error) => logger.warn(`Films site: ${err.message}`)) })

let checking: Promise<void> | null = null
/** films.py --site: where the site is now (it follows it; the end of the run tells the admins) */
export function checkFilmsSite(): Promise<void> {
  checking ??= collect('films', ['--site'], 5 * 60_000).then(() => undefined, () => undefined).finally(() => { checking = null })
  return checking
}

let timer: NodeJS.Timeout | null = null
/** Every 6 hours (first a few minutes after starting): a site down is known without searching */
export function startFilmsSiteChecker() {
  if (timer) return
  const every = Number(process.env.FILMS_SITE_CHECK_MS) || 6 * 3600_000
  timer = setInterval(() => { void checkFilmsSite() }, every)
  timer.unref()
  setTimeout(() => { void checkFilmsSite() }, 10 * 60_000).unref()
}
