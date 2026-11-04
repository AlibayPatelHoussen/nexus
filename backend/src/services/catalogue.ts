import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger'
import { collect, scriptsDir } from './downloadScripts'

/**
 * anime-sama's catalogue (downloaders/data/catalogue.json): the list anisama.py
 * searches in. Rebuilt from the site every week (CATALOGUE_REFRESH_DAYS) or on
 * demand; between two rebuilds, titles missing from it are looked up live on the
 * site and added (anisama.py).
 */
const file = () => path.join(scriptsDir(), 'data', 'catalogue.json')
const maxAgeMs = () => (Number(process.env.CATALOGUE_REFRESH_DAYS) || 7) * 24 * 3600_000

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

export async function catalogueInfo(): Promise<CatalogueInfo> {
  try {
    const st = await fs.stat(file())
    if (!countCache || countCache.mtime !== st.mtimeMs) {
      countCache = { mtime: st.mtimeMs, count: (JSON.parse(await fs.readFile(file(), 'utf8')) as unknown[]).length }
    }
    return { count: countCache.count, updatedAt: st.mtime.toISOString(), refreshing: !!running, last: lastResult }
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
    const info = await catalogueInfo()
    const age = info.updatedAt ? Date.now() - new Date(info.updatedAt).getTime() : Infinity
    if (age > maxAgeMs() && !running) await refreshCatalogue().catch(() => {})
  }
  timer = setInterval(() => { void check() }, 6 * 3600_000)
  timer.unref()
  setTimeout(() => { void check() }, 15 * 60_000).unref()
}
