// Fake TMDB / AniList / MangaDex used by the end-to-end tests (no Internet needed).
// Every request is recorded so tests can check what the scanner searched for.
import http from 'node:http'
import zlib from 'node:zlib'

// ── Tiny PNG encoder (solid colour) so the image proxy gets real images ──
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b }
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const colour = (s) => { const h = [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7); return [h & 255, (h >> 8) & 255, (h >> 16) & 255] }

const port = Number(process.env.MOCK_PORT || 4010)
const IMG = `http://localhost:${port}/img`
export const requests = []

// Fake IMDb ratings: rating 5.0–9.4 and 1 000–900 000 votes, derived from the id
export const imdbRating = (id) => ({ rating: (50 + (id * 37) % 45) / 10, votes: 1000 + (id * 131) % 899000 })
const IMDB_RATINGS = zlib.gzipSync(['tconst\taverageRating\tnumVotes',
  ...Array.from({ length: 90000 }, (_, k) => { const id = k + 1000; const r = imdbRating(id); return `tt${String(id).padStart(7, '0')}\t${r.rating.toFixed(1)}\t${r.votes}` }),
].join('\n'))

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 90000 + 1000
const title = (q) => q.replace(/\b\w/g, (c) => c.toUpperCase())

function json(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`)
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body })
    const p = url.pathname

    if (p === '/__requests') return json(res, requests)

    // ── Images (TMDB / AniList style) ──
    if (p.startsWith('/img/')) {
      if (/missing/.test(p)) { res.writeHead(404); return res.end() }
      const wide = /backdrop|still|banner/.test(p)
      res.writeHead(200, { 'Content-Type': 'image/png' })
      return res.end(png(wide ? 320 : 200, wide ? 180 : 300, colour(p)))
    }
    // ── MangaDex covers: hotlinking (a foreign Referer) is refused, like the real CDN ──
    if (p.startsWith('/covers/')) {
      if (req.headers.referer) { res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('hotlinking not allowed') }
      res.writeHead(200, { 'Content-Type': 'image/png' })
      return res.end(png(210, 300, colour(p)))   // not exactly 2:3, like many covers
    }

    // ── TMDB ──
    if (p === '/3/search/movie' || p === '/3/search/tv') {
      const q = url.searchParams.get('query') || ''
      if (/notfound/i.test(q)) return json(res, { results: [] })
      const id = hash(q)
      const tv = p.endsWith('/tv')
      return json(res, { results: [{
        id, overview: `Synopsis de ${q}.`, poster_path: `/poster_${id}.jpg`, backdrop_path: `/backdrop_${id}.jpg`,
        vote_average: 7.4, vote_count: 1234,
        ...(tv ? { name: title(q), first_air_date: '2024-10-17' } : { title: title(q), release_date: '2025-01-01' }),
      }] })
    }
    let m
    // TMDB external ids → IMDb id (tt + the TMDB id on 7 digits)
    if ((m = p.match(/^\/3\/(movie|tv)\/(\d+)\/external_ids$/))) {
      return json(res, { id: Number(m[2]), imdb_id: `tt${m[2].padStart(7, '0')}` })
    }
    // TMDB image catalogue: a textless poster, a French and an English logo, a textless backdrop
    if ((m = p.match(/^\/3\/(movie|tv)\/(\d+)\/images$/))) {
      const id = m[2]
      return json(res, {
        posters:   [{ file_path: `/keyart_${id}.jpg`, iso_639_1: null, vote_average: 6 }, { file_path: `/poster_fr_${id}.jpg`, iso_639_1: 'fr', vote_average: 9 }],
        logos:     [{ file_path: `/logo_en_${id}.png`, iso_639_1: 'en', vote_average: 9 }, { file_path: `/logo_fr_${id}.png`, iso_639_1: 'fr', vote_average: 5 }],
        backdrops: [{ file_path: `/herobackdrop_${id}.jpg`, iso_639_1: null, vote_average: 5 }],
      })
    }
    // IMDb dataset title.ratings.tsv.gz (every id the mock can hand out)
    if (p === '/imdb/title.ratings.tsv.gz') {
      res.writeHead(200, { 'Content-Type': 'application/gzip' })
      return res.end(IMDB_RATINGS)
    }
    if ((m = p.match(/^\/3\/(movie|tv)\/(\d+)$/))) {
      const id = Number(m[2]); const tv = m[1] === 'tv'
      return json(res, {
        id, overview: `Synopsis détaillé ${id}.`, poster_path: `/poster_${id}.jpg`, backdrop_path: `/backdrop_${id}.jpg`,
        genres: [{ name: 'Drame' }, { name: 'Comédie' }], vote_average: 7.4, vote_count: 1234,
        original_language: 'en', status: 'Released',
        ...(tv ? { name: `Série ${id}`, original_name: `Show ${id}`, first_air_date: '2024-10-17' }
               : { title: `Film ${id}`, original_title: `Movie ${id}`, release_date: '2025-01-01' }),
      })
    }
    if ((m = p.match(/^\/3\/tv\/(\d+)\/season\/(\d+)$/))) {
      const season = Number(m[2])
      return json(res, { episodes: Array.from({ length: 30 }, (_, i) => ({
        episode_number: i + 1, name: `Titre S${season}E${i + 1}`, overview: `Résumé de l'épisode ${i + 1}.`,
        still_path: `/still_${season}_${i + 1}.jpg`, air_date: '2024-10-17', runtime: 22,
      })) })
    }

    // ── AniList (GraphQL) ──
    if (p === '/anilist') {
      const search = (JSON.parse(body || '{}').variables || {}).search || ''
      return json(res, { data: { Media: {
        id: hash(search), title: { romaji: title(search), english: title(search), native: '日本' },
        description: `<b>Anime</b> ${search}`,
        // Like AniList: covers on a different host than the API (s4.anilist.co)
        coverImage: { large: `${IMG}/anilist/cover_${hash(search)}.png`, extraLarge: `${IMG}/anilist/cover_${hash(search)}.png` },
        bannerImage: `${IMG}/anilist/banner_${hash(search)}.png`, genres: ['Action', 'Aventure'], averageScore: 85, status: 'FINISHED', startDate: { year: 1999 },
      } } })
    }

    // ── MangaDex ──
    if (p === '/mangadex/manga') {
      const q = url.searchParams.get('title') || ''
      return json(res, { data: [{
        id: `md-${hash(q)}`,
        attributes: { title: { en: title(q) }, description: { en: `Manga ${q}` }, status: 'ongoing',
          tags: [{ attributes: { name: { en: 'Action' } } }] },
        relationships: [{ type: 'cover_art', attributes: { fileName: 'cover.jpg' } }],
      }] })
    }

    json(res, { error: 'not mocked', path: p }, 404)
  })
}).listen(port, () => console.log(`mock metadata on ${port}`))
