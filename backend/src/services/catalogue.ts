import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger'
import { collect, scriptsDir } from './downloadScripts'

/**
 * anime-sama's catalogue (downloaders/data/catalogue.json): the list anisama.py
 * searches in. Rebuilt from the site every day (CATALOGUE_REFRESH_DAYS) or on
 * demand. Searches always ask the site too (anisama.py) and add the titles
 * it finds; the catalogue completes them and answers alone if the site is down.
 */
const file = () => path.join(scriptsDir(), 'data', 'catalogue.json')
const maxAgeMs = () => (Number(process.env.CATALOGUE_REFRESH_DAYS) || 1) * 24 * 3600_000

let running: Promise<CatalogueInfo> | null = null
interface LastRefresh { at: string; added: number; error: string | null }
let lastResult: LastRefresh | null = null
let countCache: { mtime: number; count: number } | null = null

export interface CatalogueInfo {
  count: number
  updatedAt: string | null
  refreshing: boolean
  last: LastRefresh | null
}

/** Date of the last full rebuild, written by anisama.py --refresh-catalogue. */
async function rebuiltAt(): Promise<Date | null> {
  const stamp = await fs.readFile(path.join(path.dirname(file()), 'catalogue.updated'), 'utf8').catch(() => '')
  const d = new Date(stamp.trim())
  return Number.isNaN(d.getTime()) ? null : d
}

export async function catalogueInfo(): Promise<CatalogueInfo> {
  try {
    const st = await fs.stat(file())
    if (!countCache || countCache.mtime !== st.mtimeMs) {
      countCache = { mtime: st.mtimeMs, count: (JSON.parse(await fs.readFile(file(), 'utf8')) as unknown[]).length }
    }
    // catalogue.updated = last full rebuild (the json also changes when a search adds a title)
    const updatedAt = (await rebuiltAt()) ?? st.mtime
    return { count: countCache.count, updatedAt: updatedAt.toISOString(), refreshing: !!running, last: lastResult }
  } catch {
    return { count: 0, updatedAt: null, refreshing: !!running, last: lastResult }
  }
}

/** Rebuilds the catalogue (a few minutes: ~45 pages of the site). One at a time. */
export function refreshCatalogue(): Promise<CatalogueInfo> {
  if (running) return running
  running = (async () => {
    const { events, code, log } = await collect('anisama', ['--refresh-catalogue'], 30 * 60_000)
    const res = events.find((e) => e.type === 'catalogue')
    const err = events.find((e) => e.type === 'error')
    lastResult = {
      at: new Date().toISOString(),
      added: Number(res?.added ?? 0),
      error: res ? null : String(err?.message ?? `Le script s'est arrêté (code ${code})`),
    }
    if (lastResult.error) logger.warn(`Catalogue refresh: ${lastResult.error} — ${log.slice(-3).join(' | ')}`)
    else logger.info(`Catalogue refreshed: ${res?.count} titles, ${lastResult.added} new`)
    return catalogueInfo()
  })().finally(() => { running = null })
  return running
}

let timer: NodeJS.Timeout | null = null
export function startCatalogueRefresher() {
  if (timer) return
  const check = async () => {
    const at = await rebuiltAt()   // never rebuilt by Nexus yet -> rebuild now
    const age = at ? Date.now() - at.getTime() : Infinity
    if (age > maxAgeMs() && !running) await refreshCatalogue().catch(() => {})
  }
  timer = setInterval(() => { void check() }, 3600_000)
  timer.unref()
  setTimeout(() => { void check() }, 15 * 60_000).unref()
}
