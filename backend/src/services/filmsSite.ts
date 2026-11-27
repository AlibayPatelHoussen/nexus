import fs from 'fs/promises'
import path from 'path'
import { scriptsDir } from './downloadScripts'
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
  return (await filmsSite())!
}
