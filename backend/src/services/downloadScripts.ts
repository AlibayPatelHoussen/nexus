import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import readline from 'readline'
import { ValidationError } from '../utils/errors'
import { logger } from '../utils/logger'

/**
 * Runs the download scripts of downloaders/ in their --json mode.
 *
 * Security: arguments always go to spawn() as an array (never through a
 * shell), and every value is validated first (ids, languages, seasons,
 * episode / chapter lists). The scripts get a minimal environment: only the
 * variables they need, never Nexus' secrets.
 */

export type Source = 'anisama' | 'films' | 'movix' | 'oxtorrent' | 'youtube'
export type Kind = 'anime' | 'manga' | 'film' | 'serie' | 'youtube'
export const SOURCES: Source[] = ['anisama', 'movix', 'films', 'oxtorrent', 'youtube']

export const scriptsDir = () => process.env.DOWNLOADERS_DIR || path.resolve(__dirname, '../../../downloaders')
const python = () => process.env.PYTHON_BIN || 'python3'

const SCRIPT_FILE: Record<Source, string> = {
  anisama: 'anisama.py', films: 'films.py', movix: 'movix.py', oxtorrent: 'oxtorrent.py', youtube: 'youtube.py',
}

/** Id formats produced by the scripts, and the kinds they can have. */
const ID_RULES: { source: Source; re: RegExp; kind: (m: RegExpMatchArray) => Kind }[] = [
  // manga:slug~scan_one_shot = other scans of the same page (one-shot, spin-off…)
  { source: 'anisama', re: /^anisama:(anime|manga):[a-z0-9][a-z0-9-]{0,150}(~scan[a-z0-9_-]{1,80})?$/, kind: (m) => m[1] as Kind },
  { source: 'movix', re: /^movix:(tv|movie):\d{1,10}$/, kind: (m) => (m[1] === 'tv' ? 'serie' : 'film') },
  { source: 'films', re: /^films:[A-Za-z0-9_-]{4,2000}$/, kind: () => 'film' },
  { source: 'youtube', re: /^youtube:[A-Za-z0-9_-]{11}$/, kind: () => 'youtube' },
  // oxtorrent:<kind>:<id of the site's detail page> — one torrent = one job (no episode choice)
  { source: 'oxtorrent', re: /^oxtorrent:(film|serie|anime):\d{1,10}$/, kind: (m) => m[1] as Kind },
]

export function parseSourceId(id: unknown): { source: Source; kind: Kind } {
  if (typeof id === 'string') {
    for (const rule of ID_RULES) {
      const m = id.match(rule.re)
      if (m) return { source: rule.source, kind: rule.kind(m) }
    }
  }
  throw new ValidationError('Identifiant de média invalide')
}

/** Where each kind is saved (configurable, same variables as the library). */
export function destFor(kind: Kind): string {
  switch (kind) {
    case 'anime': return process.env.ANIMES_PATH || '/media/animes'
    case 'manga': return process.env.MANGA_PATH || '/media/scans'
    case 'film': return process.env.FILMS_PATH || '/media/films'
    case 'serie': return process.env.SERIES_PATH || '/media/series'
    case 'youtube': return process.env.YOUTUBE_PATH || '/media/youtube'
  }
}

export const LANG_RE = /^[A-Z0-9]{2,8}$/
export const SEASON_RE = /^((saison\d{1,3}|kai\d{0,2}|film\d{0,2}|oav\d{0,2})(hs)?|saison\d{1,3}-\d{1,3}|speciaux|specials?|\d{1,3})$/

/** A list of episode / chapter numbers -> compact text for the script ("1-3,7"). */
export function selectionArg(list: unknown): string | null {
  if (list == null) return null
  if (!Array.isArray(list) || list.length === 0 || list.length > 5000) throw new ValidationError('Sélection invalide')
  const nums = [...new Set(list.map((v) => Number(v)))]
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 100000 || Math.round(n * 10) !== n * 10)) {
    throw new ValidationError('Sélection invalide')
  }
  nums.sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < nums.length; i++) {
    let j = i
    while (Number.isInteger(nums[j]) && nums[j + 1] === nums[j] + 1) j++
    parts.push(j > i ? `${nums[i]}-${nums[j]}` : String(nums[i]))
    i = j
  }
  return parts.join(',')
}

/** Variables the scripts may see (no DB password, no JWT secret…). */
function scriptEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'USER', 'TMDB_API_KEY', 'PLAYWRIGHT_BROWSERS_PATH', 'OXTORRENT_URL',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']
  const env: NodeJS.ProcessEnv = { PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }
  for (const k of keep) if (process.env[k]) env[k] = process.env[k]
  return env
}

export interface ScriptEvent { type: string; [key: string]: unknown }

export interface RunHandle {
  child: ChildProcess
  /** Resolves when the script exits */
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null; log: string[] }>
  /** Stops the script and everything it started (ffmpeg, browser) */
  kill: () => void
}

/** Starts a script with --json and calls onEvent for each JSON line. */
export function runScript(source: Source, args: string[], onEvent: (e: ScriptEvent) => void, timeoutMs = 0): RunHandle {
  const file = path.join(scriptsDir(), SCRIPT_FILE[source])
  const child = spawn(python(), [file, '--json', ...args], {
    cwd: scriptsDir(),
    env: scriptEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,   // own process group: kill() also stops ffmpeg / chromium
  })
  const log: string[] = []
  const keepLog = (line: string) => { log.push(line); if (log.length > 200) log.shift() }

  readline.createInterface({ input: child.stdout! }).on('line', (line) => {
    if (!line.trim()) return
    try {
      const ev = JSON.parse(line) as ScriptEvent
      if (ev && typeof ev.type === 'string') onEvent(ev)
    } catch {
      keepLog(line)
    }
  })
  // eslint-disable-next-line no-control-regex
  readline.createInterface({ input: child.stderr! }).on('line', (line) => keepLog(line.replace(/\x1b\[[0-9;]*m/g, '')))

  let killed = false
  const kill = () => {
    if (killed || child.exitCode !== null) return
    killed = true
    const group = (sig: NodeJS.Signals) => {
      try { if (child.pid) process.kill(-child.pid, sig) } catch { try { child.kill(sig) } catch { /* gone */ } }
    }
    group('SIGTERM')
    setTimeout(() => { if (child.exitCode === null) group('SIGKILL') }, 5000).unref()
  }
  const timer = timeoutMs > 0 ? setTimeout(() => { keepLog(`timeout after ${timeoutMs} ms`); kill() }, timeoutMs) : null

  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; log: string[] }>((resolve) => {
    child.on('error', (err) => {
      keepLog(`spawn error: ${err.message}`)
      logger.error(`Download script ${source} could not start: ${err.message}`)
    })
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer)
      resolve({ code, signal, log })
    })
  })
  return { child, done, kill }
}

/** Runs a short script call (search / details) and collects its events. */
export async function collect(source: Source, args: string[], timeoutMs: number, onEvent?: (e: ScriptEvent) => void) {
  const events: ScriptEvent[] = []
  const h = runScript(source, args, (e) => { events.push(e); onEvent?.(e) }, timeoutMs)
  const res = await h.done
  return { events, ...res }
}
