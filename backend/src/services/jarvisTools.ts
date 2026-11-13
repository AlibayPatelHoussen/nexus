import fs from 'fs'
import { query } from '../config/database'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors'
import { collect, parseSourceId, SOURCES, langLabel, type Source } from './downloadScripts'
import { actOn, createDownload, getDetails, listDownloads } from './downloads'
import { addFavorite, assertChannelId, getChannel, listChannels, removeFavorite } from './iptv'
import { deleteMediaEverywhere } from './libraryDelete'
import { isLibraryType, LIBRARY_TYPES, scanLibrary, type LibraryType } from './libraryScan'
import { MediaScanner } from './scanner'

/**
 * Nexus actions offered to Jarvis as tools.
 *
 * Jarvis fetches the manifest (GET /api/jarvis/tools/manifest) and lets its model call
 * these tools; each call comes back to POST /api/jarvis/tools/:name with the Jarvis
 * user. The user is resolved again here (role read from the database): what Jarvis may
 * do in Nexus is exactly what that account may do in the interface.
 */

export interface NexusUser { id: string; username: string; role: 'admin' | 'user' }

type Args = Record<string, unknown>
interface ToolDef {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, { type: string; description?: string; enum?: string[] }>; required: string[] }
  /** Downloads and deletions: admins only (same rule as the interface) */
  adminOnly?: boolean
  /** Jarvis asks the user before running it */
  confirm?: boolean
  run: (args: Args, user: NexusUser) => Promise<string>
}

// ─── Small helpers ────────────────────────────────────────────────────────

const text = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const LIBRARY_NAMES: Record<LibraryType, string> = {
  films: 'Films', series: 'Séries', animes: 'Animes', manga: 'Manga', youtube: 'YouTube',
}
const TYPE_ENUM = Object.keys(LIBRARY_TYPES)

function libraryType(v: unknown): LibraryType | null {
  const t = text(v, 20).toLowerCase()
  if (!t || t === 'tout' || t === 'tous' || t === 'all') return null
  const aliases: Record<string, LibraryType> = {
    film: 'films', serie: 'series', série: 'series', séries: 'series', anime: 'animes', animé: 'animes',
    animés: 'animes', mangas: 'manga', scans: 'manga', webtoon: 'manga', webtoons: 'manga',
  }
  const type = aliases[t] ?? t
  if (!isLibraryType(type)) throw new ValidationError(`Bibliothèque inconnue : ${t} (films, series, animes, manga, youtube)`)
  return type
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} Go`
}

/** « 1-5, 8, 10-12 » → [1,2,3,4,5,8,10,11,12]; « tout » → all of `available`. */
export function parseNumbers(spec: unknown, available: number[]): number[] {
  const s = text(spec, 300).toLowerCase()
  if (!s || /^(tout|tous|toutes|all|\*)$/.test(s)) return available
  const out = new Set<number>()
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d+(?:\.\d+)?)\s*[-–à]\s*(\d+(?:\.\d+)?)$/)
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y)
      if (b - a > 5000) throw new ValidationError('Plage trop grande')
      for (const n of available.length ? available : []) if (n >= a && n <= b) out.add(n)
      if (!available.length) for (let n = Math.ceil(a); n <= b; n++) out.add(n)
    } else if (/^\d+(\.\d+)?$/.test(part)) {
      out.add(Number(part))
    } else {
      throw new ValidationError(`Liste invalide : « ${part} » (exemples : 3, 1-12, 1-5,8, tout)`)
    }
  }
  return [...out].sort((a, b) => a - b)
}

// ─── Download search cache (title / poster / versions of an id) ──────────

interface SearchHit {
  id: string; source: Source; kind: string; title: string; poster_url?: string | null; year?: number | null
  langs?: string[]; seasons?: { id: string | number; label: string; langs?: string[]; episodes_count?: number }[]
  versions?: { id: string; resolution: string | null; language: string | null; language_family: string | null; size: string; size_bytes: number | null; seeders: number }[]
  channel?: string | null; duration?: number | null
}
const hits = new Map<string, { at: number; hit: SearchHit }>()
const HIT_TTL = 60 * 60_000

function remember(hit: SearchHit) {
  hits.set(hit.id, { at: Date.now(), hit })
  for (const v of hit.versions ?? []) hits.set(v.id, { at: Date.now(), hit })
  if (hits.size > 2000) hits.delete(hits.keys().next().value as string)
}
function recall(id: string): SearchHit | null {
  const entry = hits.get(id)
  return entry && Date.now() - entry.at < HIT_TTL ? entry.hit : null
}

const SEARCH_MS = () => Number(process.env.JARVIS_SEARCH_TIMEOUT_MS) || 60_000
const resRank = (r: string | null) => ({ '2160p': 4, '1080p': 3, '720p': 2, '480p': 1 }[r ?? ''] ?? 0)

/** Best torrent version: 1080p first, shared, reasonable size (same idea as the interface). */
function bestVersion(versions: NonNullable<SearchHit['versions']>, language?: string) {
  const wanted = language ? versions.filter((v) => v.language_family === language.toUpperCase()) : versions
  const list = (wanted.length ? wanted : versions).filter((v) => v.seeders > 0)
  const score = (v: (typeof list)[number]) => ({ 3: 30, 4: 20, 2: 15, 1: 5, 0: 3 }[resRank(v.resolution)] ?? 0)
    + Math.log10(v.seeders + 1) * 10 - (v.size_bytes && v.size_bytes > 15 * 1024 ** 3 ? 15 : 0)
  return list.length ? list.reduce((a, b) => (score(b) > score(a) ? b : a)) : null
}

// ─── The tools ─────────────────────────────────────────────────────────────

const TOOLS: ToolDef[] = [
  // ── Library ──
  {
    name: 'nexus_bibliotheque',
    description: 'Fait le point sur la bibliothèque multimédia de Nexus : nombre de films, séries, animes, mangas, vidéos YouTube, épisodes et chapitres, titres sans affiche ou non reconnus, derniers ajouts, espace disque. Pour « analyse ma bibliothèque », appelle d’abord nexus_analyser_bibliotheque puis cet outil.',
    parameters: { type: 'object', properties: {
      type: { type: 'string', description: 'Bibliothèque à détailler (films, series, animes, manga, youtube). Vide = toutes.', enum: TYPE_ENUM },
    }, required: [] },
    run: async (args) => {
      const type = libraryType(args.type)
      const dbTypes = type ? (type === 'manga' ? ['manga', 'webtoon'] : [LIBRARY_TYPES[type]]) : null
      const filter = dbTypes ? 'WHERE m.type = ANY($1)' : ''
      const params = dbTypes ? [dbTypes] : []
      const { rows: counts } = await query<{ type: string; n: string; no_poster: string; unknown: string; size: string }>(
        `SELECT m.type, COUNT(*) AS n,
           COUNT(*) FILTER (WHERE m.poster_path IS NULL) AS no_poster,
           COUNT(*) FILTER (WHERE m.tmdb_id IS NULL AND m.anilist_id IS NULL AND m.mangadex_id IS NULL AND m.type <> 'youtube') AS unknown,
           COALESCE(SUM(m.file_size), 0) AS size
         FROM media_items m ${filter} GROUP BY m.type ORDER BY m.type`, params)
      const { rows: [eps] } = await query<{ n: string; size: string }>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(e.file_size), 0) AS size FROM episodes e
         JOIN media_items m ON m.id = e.media_item_id ${filter}`, params)
      const { rows: [chs] } = await query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM chapters c JOIN media_items m ON m.id = c.media_item_id ${filter}`, params)
      const { rows: recent } = await query<{ title: string; type: string; created_at: Date }>(
        `SELECT m.title, m.type, m.created_at FROM media_items m ${filter} ORDER BY m.created_at DESC LIMIT 5`, params)
      const { rows: unknownTitles } = await query<{ title: string; type: string }>(
        `SELECT m.title, m.type FROM media_items m
         WHERE m.tmdb_id IS NULL AND m.anilist_id IS NULL AND m.mangadex_id IS NULL AND m.type <> 'youtube'
         ${dbTypes ? 'AND m.type = ANY($1)' : ''} ORDER BY m.title LIMIT 10`, params)

      const lines = [`Bibliothèque${type ? ` « ${LIBRARY_NAMES[type]} »` : ''} :`]
      if (!counts.length) lines.push('- vide')
      let total = Number(eps?.size ?? 0)
      for (const c of counts) {
        total += Number(c.size)
        const issues = [Number(c.no_poster) && `${c.no_poster} sans affiche`, Number(c.unknown) && `${c.unknown} non reconnus`].filter(Boolean)
        lines.push(`- ${c.type} : ${c.n} titre(s)${issues.length ? ` (${issues.join(', ')})` : ''}`)
      }
      lines.push(`- épisodes : ${eps?.n ?? 0}, chapitres : ${chs?.n ?? 0}, taille connue : ${gb(total)}`)
      if (unknownTitles.length) lines.push(`Non reconnus (pas de métadonnées) : ${unknownTitles.map((t) => `${t.title} (${t.type})`).join(', ')}`)
      if (recent.length) lines.push(`Derniers ajouts : ${recent.map((r) => `${r.title} (${r.type})`).join(', ')}`)
      try {
        const st = await fs.promises.statfs(process.env.MEDIA_ROOT || '/media')
        lines.push(`Espace libre sur le disque des médias : ${gb(st.bavail * st.bsize)} sur ${gb(st.blocks * st.bsize)}`)
      } catch { /* not available */ }
      const running = MediaScanner.isRunning()
      if (running) lines.push(`Une analyse est en cours (${running}).`)
      return lines.join('\n')
    },
  },
  {
    name: 'nexus_chercher_media',
    description: 'Cherche un titre déjà présent dans la bibliothèque Nexus (film, série, anime, manga, vidéo YouTube) : type, année, épisodes / chapitres présents, identifiant et dossier.',
    parameters: { type: 'object', properties: {
      recherche: { type: 'string', description: 'Titre (ou partie du titre)' },
      type: { type: 'string', description: 'Limiter à une bibliothèque', enum: TYPE_ENUM },
    }, required: ['recherche'] },
    run: async (args, user) => {
      const q = text(args.recherche, 100)
      if (q.length < 2) throw new ValidationError('Recherche trop courte')
      const type = libraryType(args.type)
      const params: unknown[] = [`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`]
      let where = '(m.title ILIKE $1 OR m.original_title ILIKE $1)'
      if (type) { params.push(type === 'manga' ? ['manga', 'webtoon'] : [LIBRARY_TYPES[type]]); where += ' AND m.type = ANY($2)' }
      const { rows } = await query<{ id: string; type: string; title: string; year: number | null; file_path: string; eps: string; seasons: string; chs: string }>(
        `SELECT m.id, m.type, m.title, m.year, m.file_path,
           (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = m.id) AS eps,
           (SELECT COUNT(DISTINCT e.season) FROM episodes e WHERE e.media_item_id = m.id) AS seasons,
           (SELECT COUNT(*) FROM chapters c WHERE c.media_item_id = m.id) AS chs
         FROM media_items m WHERE ${where} ORDER BY similarity(m.title, $${params.length + 1}) DESC, m.title LIMIT 15`,
        [...params, q])
      if (!rows.length) return `Aucun titre « ${q} » dans la bibliothèque.`
      return rows.map((r) => {
        const content = Number(r.chs) ? `${r.chs} chapitre(s)` : Number(r.eps) ? `${r.eps} épisode(s), ${r.seasons} saison(s)` : ''
        const where2 = user.role === 'admin' ? ` · ${r.file_path}` : ''
        return `- ${r.title}${r.year ? ` (${r.year})` : ''} · ${r.type}${content ? ` · ${content}` : ''} · id ${r.id}${where2}`
      }).join('\n')
    },
  },
  {
    name: 'nexus_analyser_bibliotheque',
    description: 'Analyse (scanne) une bibliothèque Nexus ou toutes : ajoute les nouveaux fichiers, retire ce qui a été supprimé, cherche affiches et métadonnées. À lancer après un téléchargement terminé, un renommage ou une suppression de fichiers.',
    parameters: { type: 'object', properties: {
      type: { type: 'string', description: 'Bibliothèque (films, series, animes, manga, youtube). Vide = toutes.', enum: TYPE_ENUM },
    }, required: [] },
    run: async (args) => {
      const running = MediaScanner.isRunning()
      if (running) return `Une analyse est déjà en cours (${running}). Réessaie dans quelques minutes.`
      const type = libraryType(args.type)
      const types = type ? [type] : (Object.keys(LIBRARY_TYPES) as LibraryType[])
      const scan = (async () => {
        const done: string[] = []
        for (const t of types) done.push(`${LIBRARY_NAMES[t]} : ${await scanLibrary(t)} titre(s)`)
        return done
      })()
      // A big library can take minutes: answer after 90 s at most, the scan goes on
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 90_000).unref())
      try {
        const done = await Promise.race([scan, timeout])
        if (!done) { scan.catch(() => {}); return 'Analyse lancée : elle continue en arrière-plan (grosse bibliothèque). Demande le point dans quelques minutes (nexus_bibliotheque).' }
        return `Analyse terminée — ${done.join(', ')}.`
      } catch (err) {
        if (err instanceof ConflictError) return 'Une autre analyse vient de démarrer. Réessaie dans quelques minutes.'
        throw err
      }
    },
  },
  {
    name: 'nexus_supprimer_media',
    description: 'Supprime définitivement un titre de la bibliothèque Nexus : ses fichiers sur le disque, la bibliothèque, ses téléchargements et son suivi. Demande d’abord l’identifiant avec nexus_chercher_media. L’utilisateur doit confirmer.',
    parameters: { type: 'object', properties: {
      id: { type: 'string', description: 'Identifiant du titre (nexus_chercher_media)' },
    }, required: ['id'] },
    adminOnly: true,
    confirm: true,
    run: async (args) => {
      const id = text(args.id, 40)
      const { rows } = await query<{ title: string }>('SELECT title FROM media_items WHERE id::text = $1', [id])
      if (!rows[0]) throw new NotFoundError('Titre')
      const r = await deleteMediaEverywhere(id)
      return `« ${rows[0].title} » supprimé : ${r.files.length} fichier(s) / dossier(s) effacé(s), ${r.downloads} téléchargement(s) et ${r.follows} suivi(s) retirés.`
    },
  },

  // ── Downloads ──
  {
    name: 'nexus_chercher_telechargement',
    description: 'Cherche un film, une série, un anime, un manga ou une vidéo YouTube à télécharger, sur toutes les sources de Nexus (anime-sama, movix, tiprov, OxTorrent, YouTube). Renvoie des identifiants à passer à nexus_details_telechargement puis nexus_telecharger.',
    parameters: { type: 'object', properties: {
      recherche: { type: 'string', description: 'Titre à chercher, ex. « One Piece », « Dune »' },
      type: { type: 'string', description: 'Garder seulement ce type', enum: ['film', 'serie', 'anime', 'manga', 'youtube'] },
    }, required: ['recherche'] },
    adminOnly: true,
    run: async (args) => {
      const q = text(args.recherche, 200)
      if (q.length < 2 || /[\0\r\n]/.test(q)) throw new ValidationError('Recherche invalide')
      const kind = text(args.type, 10).toLowerCase()
      const results = await Promise.all(SOURCES.map(async (source) => {
        try {
          const { events } = await collect(source, ['--search', q], SEARCH_MS())
          return events.filter((e) => e.type === 'result') as unknown as SearchHit[]
        } catch { return [] }
      }))
      const found = results.flat().filter((h) => typeof h.id === 'string' && (!kind || h.kind === kind))
      found.forEach(remember)
      if (!found.length) return `Rien trouvé pour « ${q} »${kind ? ` (${kind})` : ''}.`
      return found.slice(0, 20).map((h) => {
        const bits = [h.kind, h.year, h.langs?.length ? `langues ${h.langs.map(langLabel).join('/')}` : null,
          h.seasons?.length && h.source !== 'oxtorrent' ? `${h.seasons.length} saison(s)` : null,
          h.versions?.length ? `${h.versions.length} version(s) torrent` : null, h.channel].filter(Boolean)
        return `- ${h.title} · ${bits.join(' · ')} · id ${h.id}`
      }).join('\n') + (found.length > 20 ? `\n(${found.length - 20} autres résultats)` : '')
    },
  },
  {
    name: 'nexus_details_telechargement',
    description: 'Saisons, épisodes (anime / série) ou chapitres (manga) disponibles pour un résultat de nexus_chercher_telechargement, avec les langues et ce qui est déjà téléchargé.',
    parameters: { type: 'object', properties: {
      id: { type: 'string', description: 'Identifiant renvoyé par nexus_chercher_telechargement' },
    }, required: ['id'] },
    adminOnly: true,
    run: async (args) => {
      const id = text(args.id, 2000)
      const { source, kind } = parseSourceId(id)
      if (source === 'oxtorrent') {
        const hit = recall(id)
        if (!hit?.versions?.length) return 'Torrent : refais la recherche (nexus_chercher_telechargement) pour voir les versions.'
        return `${hit.title} — versions :\n` + hit.versions.slice(0, 8).map((v) =>
          `- ${[v.resolution, v.language, v.size].filter(Boolean).join(' · ')} · ${v.seeders} sources · id ${v.id}`).join('\n')
      }
      if (kind === 'film' || kind === 'youtube') return 'Film / vidéo : se télécharge en entier, appelle directement nexus_telecharger.'
      const d = await getDetails(id) as { title?: string; seasons?: { id: string | number; lang?: string; langs?: string[]; label: string; episodes: { n: number; downloaded: boolean | string[]; available?: boolean }[] }[]; langs?: ({ lang: string; label?: string; chapters?: { n: number; downloaded: boolean }[] } | string)[] }
      const range = (ns: number[]) => {
        if (!ns.length) return 'aucun'
        const parts: string[] = []
        let start = ns[0], prev = ns[0]
        for (const n of [...ns.slice(1), NaN]) {
          if (n === prev + 1) { prev = n; continue }
          parts.push(start === prev ? `${start}` : `${start}-${prev}`)
          start = prev = n
        }
        return parts.join(', ')
      }
      const lines = [`${d.title ?? id} :`]
      if (kind === 'manga') {
        for (const l of d.langs ?? []) {
          if (typeof l === 'string') continue
          const chs = l.chapters ?? []
          lines.push(`- ${l.label || langLabel(l.lang)} (langue ${l.lang}) : chapitres ${range(chs.map((c) => c.n))}`
            + `${chs.some((c) => c.downloaded) ? ` — déjà téléchargés : ${range(chs.filter((c) => c.downloaded).map((c) => c.n))}` : ''}`)
        }
      } else {
        for (const s of d.seasons ?? []) {
          const eps = s.episodes.filter((e) => e.available !== false)
          const had = eps.filter((e) => (Array.isArray(e.downloaded) ? (s.lang ? e.downloaded.includes(s.lang) : e.downloaded.length > 0) : e.downloaded))
          lines.push(`- saison « ${s.label} » (saison ${s.id}${s.lang ? `, langue ${s.lang}` : s.langs?.length ? `, langues ${s.langs.join('/')}` : ''}) : épisodes ${range(eps.map((e) => e.n))}`
            + `${had.length ? ` — déjà téléchargés : ${range(had.map((e) => e.n))}` : ''}`)
        }
      }
      return lines.join('\n')
    },
  },
  {
    name: 'nexus_telecharger',
    description: 'Met un téléchargement dans la file de Nexus. Film / vidéo : juste l’id. Anime / série : saison + épisodes. Manga : chapitres. Les fichiers arrivent dans la bibliothèque, qui est analysée à la fin.',
    parameters: { type: 'object', properties: {
      id: { type: 'string', description: 'Identifiant (nexus_chercher_telechargement ou version torrent de nexus_details_telechargement)' },
      saison: { type: 'string', description: 'Anime / série : saison (id de nexus_details_telechargement, ex. « 1 » ou « saison1 »)' },
      langue: { type: 'string', description: 'VOSTFR, VF… (défaut : VOSTFR pour les animes, sinon la première disponible)' },
      episodes: { type: 'string', description: 'Anime / série : « 3 », « 1-12 », « 1-5,8 » ou « tout »' },
      chapitres: { type: 'string', description: 'Manga : « 1050 », « 1000-1010 » ou « tout »' },
      forcer: { type: 'boolean', description: 'true pour retélécharger ce qui l’est déjà' },
    }, required: ['id'] },
    adminOnly: true,
    run: async (args, user) => {
      const id = text(args.id, 2000)
      const { source, kind } = parseSourceId(id)
      const hit = recall(id)
      const force = args.forcer === true
      const langWanted = text(args.langue, 12).toUpperCase()

      if (source === 'oxtorrent') {
        if (!hit?.versions?.length) return 'Torrent : refais d’abord la recherche (nexus_chercher_telechargement).'
        if (hit.kind !== 'film') return 'Pour une série en torrent, utilise plutôt anime-sama ou movix (épisodes au choix).'
        const version = hit.versions.find((v) => v.id === id) ?? bestVersion(hit.versions, langWanted || undefined)
        if (!version) return 'Aucune version partagée en ce moment pour ce torrent.'
        const job = await createDownload({ id: version.id, title: hit.title, poster_url: hit.poster_url ?? null, item: hit.id,
          version: { resolution: version.resolution, language: version.language }, force }, user.id)
        return `« ${job.title} » ajouté à la file (${[version.resolution, version.language, version.size].filter(Boolean).join(' · ')}).`
      }

      const base = { id, title: hit?.title ?? '', poster_url: hit?.poster_url ?? null, force }
      if (kind === 'film' || kind === 'youtube') {
        const title = base.title || String((await getDetails(id).catch(() => ({} as Record<string, unknown>))).title ?? '')
        const job = await createDownload({ ...base, title: title || id, ...(kind === 'film' && source !== 'films' && langWanted ? { lang: langWanted } : {}) }, user.id)
        return `« ${job.title} » ajouté à la file des téléchargements.`
      }

      const d = await getDetails(id) as { title?: string; poster_url?: string | null; seasons?: { id: string | number; lang?: string; langs?: string[]; label: string; episodes: { n: number; available?: boolean }[] }[]; langs?: ({ lang: string; chapters?: { n: number }[] } | string)[] }
      const title = base.title || d.title || id
      if (kind === 'manga') {
        const editions = (d.langs ?? []).filter((l): l is { lang: string; chapters?: { n: number }[] } => typeof l !== 'string')
        if (!editions.length) return 'Aucun chapitre disponible pour ce manga.'
        const pool = langWanted ? editions.filter((l) => l.lang === langWanted) : editions
        if (!pool.length) return `Pas d’édition ${langWanted}. Éditions : ${editions.map((l) => l.lang).join(', ')}`
        // The edition that has the most of the requested chapters; plain VF first on a tie
        const rank = (l: (typeof pool)[number]) => [
          parseNumbers(args.chapitres, (l.chapters ?? []).map((c) => c.n))
            .filter((n) => (l.chapters ?? []).some((c) => c.n === n)).length,
          l.lang === 'VF' ? 2 : l.lang.startsWith('VF') ? 1 : 0,
        ]
        const edition = pool.reduce((a, b) => {
          const [ra, rb] = [rank(a), rank(b)]
          return rb[0] > ra[0] || (rb[0] === ra[0] && rb[1] > ra[1]) ? b : a
        })
        const chapters = parseNumbers(args.chapitres, (edition.chapters ?? []).map((c) => c.n))
          .filter((n) => !args.chapitres || /tout|all|\*/i.test(String(args.chapitres))
            || (edition.chapters ?? []).some((c) => c.n === n))
        if (!chapters.length) return `Aucun chapitre correspondant (disponibles en ${edition.lang}).`
        const job = await createDownload({ ...base, title, lang: edition.lang, chapters, force }, user.id)
        return `« ${job.title} » : ${chapters.length} chapitre(s) ajouté(s) à la file (${edition.lang}).`
      }

      // anime / serie
      const seasons = d.seasons ?? []
      if (!seasons.length) return 'Aucune saison disponible.'
      const wanted = text(args.saison, 40).toLowerCase()
      const digits = wanted.match(/\d+/)?.[0]
      const sameSeason = (s: (typeof seasons)[number]) => !wanted
        || String(s.id).toLowerCase() === wanted || s.label.toLowerCase() === wanted
        || (!!digits && (String(s.id).match(/\d+/)?.[0] === digits || s.label.match(/\d+/)?.[0] === digits))
      const candidates = seasons.filter(sameSeason)
      if (!candidates.length) return `Saison « ${wanted} » introuvable. Saisons : ${seasons.map((s) => `${s.label} (${s.id})`).join(', ')}`
      let season = candidates[0]
      let lang = langWanted
      if (kind === 'anime') {
        season = candidates.find((s) => s.lang === langWanted) ?? candidates.find((s) => s.lang === 'VOSTFR') ?? candidates[0]
        lang = season.lang ?? langWanted
      } else if (!lang || !(season.langs ?? []).includes(lang)) {
        lang = season.langs?.[0] ?? lang
      }
      const episodes = parseNumbers(args.episodes, season.episodes.filter((e) => e.available !== false).map((e) => e.n))
      if (!episodes.length) return 'Aucun épisode correspondant dans cette saison.'
      const job = await createDownload({ ...base, title, season: String(season.id), episodes, ...(lang ? { lang } : {}), force }, user.id)
      return `« ${job.title} » — ${season.label}${lang ? ` (${lang})` : ''} : ${episodes.length} épisode(s) ajouté(s) à la file.`
    },
  },
  {
    name: 'nexus_telechargements',
    description: 'Liste la file des téléchargements de Nexus (en cours, en attente, en pause, terminés, échoués) avec leur progression.',
    parameters: { type: 'object', properties: {}, required: [] },
    adminOnly: true,
    run: async () => {
      const list = (await listDownloads()) as { id: string; title: string; status: string; progress: { percent?: number | null; index?: number; total?: number }; error: string | null; options: { season?: string; lang?: string } }[]
      if (!list.length) return 'Aucun téléchargement.'
      const STATUS: Record<string, string> = { running: 'en cours', queued: 'en attente', paused: 'en pause', done: 'terminé', failed: 'échoué', cancelled: 'annulé' }
      return list.slice(0, 15).map((d) => {
        const p = d.progress ?? {}
        const prog = d.status === 'running' ? [p.total ? `${p.index ?? 0}/${p.total}` : null, p.percent != null ? `${Math.round(p.percent)} %` : null].filter(Boolean).join(' · ') : ''
        return `- ${d.title}${d.options?.season ? ` (${d.options.season})` : ''} · ${STATUS[d.status] ?? d.status}${prog ? ` · ${prog}` : ''}${d.error ? ` · ${d.error}` : ''} · id ${d.id}`
      }).join('\n')
    },
  },
  {
    name: 'nexus_gerer_telechargement',
    description: 'Met en pause, reprend, annule ou relance un téléchargement de la file (id de nexus_telechargements).',
    parameters: { type: 'object', properties: {
      id: { type: 'string', description: 'Identifiant du téléchargement' },
      action: { type: 'string', description: 'pause, reprendre, annuler ou relancer', enum: ['pause', 'reprendre', 'annuler', 'relancer'] },
    }, required: ['id', 'action'] },
    adminOnly: true,
    run: async (args) => {
      const map: Record<string, 'pause' | 'resume' | 'cancel' | 'retry'> = {
        pause: 'pause', reprendre: 'resume', annuler: 'cancel', relancer: 'retry', resume: 'resume', cancel: 'cancel', retry: 'retry',
      }
      const action = map[text(args.action, 20).toLowerCase()]
      if (!action) throw new ValidationError('Action : pause, reprendre, annuler ou relancer')
      const d = await actOn(text(args.id, 60), action) as { title: string; status: string }
      return `« ${d.title} » : ${{ pause: 'mis en pause', resume: 'repris', cancel: 'annulé', retry: 'relancé' }[action]}.`
    },
  },

  // ── IPTV ──
  {
    name: 'nexus_chercher_chaine',
    description: 'Cherche une chaîne de télévision (IPTV) dans Nexus : nom, pays, état (en ligne / hors ligne), favori, identifiant.',
    parameters: { type: 'object', properties: {
      recherche: { type: 'string', description: 'Nom de la chaîne, ex. « TF1 », « France 24 », « BFM »' },
      pays: { type: 'string', description: 'Code pays sur 2 lettres, ex. FR, BE, CH' },
    }, required: ['recherche'] },
    run: async (args, user) => {
      const q = text(args.recherche, 100)
      if (!q) throw new ValidationError('Nom de chaîne manquant')
      const { items, total } = await listChannels(user.id, { q, country: text(args.pays, 2) || undefined, limit: 10 })
      if (!items.length) return `Aucune chaîne « ${q} ».`
      const STATE = { online: 'en ligne', offline: 'hors ligne', unknown: 'non vérifiée' }
      return items.map((c) => `- ${c.name}${c.country ? ` (${c.country})` : ''} · ${STATE[c.status]}${c.favorite ? ' · favori' : ''} · id ${c.id}`).join('\n')
        + (total > items.length ? `\n(${total - items.length} autres)` : '')
    },
  },
  {
    name: 'nexus_ouvrir_chaine',
    description: 'Met une chaîne IPTV : renvoie le lien qui l’ouvre dans le lecteur de Nexus. Donne ce lien tel quel à l’utilisateur, au format markdown [Regarder <nom>](<lien>).',
    parameters: { type: 'object', properties: {
      id: { type: 'string', description: 'Identifiant de la chaîne (nexus_chercher_chaine)' },
    }, required: ['id'] },
    run: async (args, user) => {
      const channel = await getChannel(user.id, assertChannelId(text(args.id, 120)))
      const warn = channel.status === 'offline' ? ' (attention : elle était hors ligne à la dernière vérification)' : ''
      return `Lien : /iptv/watch/${encodeURIComponent(channel.id)} — ${channel.name}${warn}.`
    },
  },
  {
    name: 'nexus_favori_chaine',
    description: 'Ajoute une chaîne IPTV aux favoris de l’utilisateur, ou l’en retire.',
    parameters: { type: 'object', properties: {
      id: { type: 'string', description: 'Identifiant de la chaîne (nexus_chercher_chaine)' },
      ajouter: { type: 'boolean', description: 'true = ajouter (défaut), false = retirer' },
    }, required: ['id'] },
    run: async (args, user) => {
      const id = assertChannelId(text(args.id, 120))
      const channel = await getChannel(user.id, id)
      if (args.ajouter === false) {
        await removeFavorite(user.id, id)
        return `${channel.name} retirée des favoris.`
      }
      await addFavorite(user.id, id)
      return `${channel.name} ajoutée aux favoris.`
    },
  },
]

// ─── Manifest, user, execution ───────────────────────────────────────────

/** What Jarvis needs to offer these tools to its model. */
export function manifest() {
  return {
    name: 'Nexus',
    description: 'Serveur multimédia : bibliothèque (films, séries, animes, mangas, YouTube), téléchargements, chaînes IPTV.',
    tools: TOOLS.map((t) => ({
      name: t.name, description: t.description, parameters: t.parameters,
      confirm: !!t.confirm, roles: t.adminOnly ? ['admin'] : ['admin', 'user'],
    })),
  }
}

/** Nexus account behind a Jarvis user ("owner" = JARVIS_OWNER, else the Nexus user id). */
export async function resolveUser(jarvisUser: unknown): Promise<NexusUser> {
  const id = typeof jarvisUser === 'string' ? jarvisUser : ''
  const owner = (process.env.JARVIS_OWNER || '').trim().toLowerCase()
  const { rows } = id === 'owner'
    ? owner
      ? await query<NexusUser>('SELECT id, username, role FROM users WHERE lower(username) = $1', [owner])
      : { rows: [] as NexusUser[] }
    : /^[0-9a-f-]{36}$/i.test(id)
      ? await query<NexusUser>('SELECT id, username, role FROM users WHERE id = $1', [id])
      : { rows: [] as NexusUser[] }
  if (!rows[0]) {
    throw new ForbiddenError(id === 'owner'
      ? 'Ce compte Jarvis n’est relié à aucun compte Nexus (JARVIS_OWNER dans le .env de Nexus).'
      : 'Utilisateur inconnu de Nexus.')
  }
  return rows[0]
}

/** Runs a tool for a Jarvis user. Errors become a readable sentence for the model. */
export async function runTool(name: string, args: unknown, jarvisUser: unknown): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) throw new NotFoundError('Outil')
  const user = await resolveUser(jarvisUser)
  if (tool.adminOnly && user.role !== 'admin') return 'Refusé : cette action est réservée aux administrateurs de Nexus.'
  try {
    return await tool.run((args && typeof args === 'object' ? args : {}) as Args, user)
  } catch (err) {
    if (err instanceof ValidationError || err instanceof ConflictError || err instanceof NotFoundError || err instanceof ForbiddenError) {
      return `Erreur : ${err.message}`
    }
    throw err
  }
}
