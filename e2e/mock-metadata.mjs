// Fake TMDB / AniList / MangaDex used by the end-to-end tests (no Internet needed).
// Every request is recorded so tests can check what the scanner searched for.
import http from 'node:http'

const port = Number(process.env.MOCK_PORT || 4010)
export const requests = []

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
        description: `<b>Anime</b> ${search}`, coverImage: { large: 'https://img.anilist.co/c.jpg', extraLarge: 'https://img.anilist.co/c.jpg' },
        bannerImage: 'https://img.anilist.co/b.jpg', genres: ['Action', 'Aventure'], averageScore: 85, status: 'FINISHED', startDate: { year: 1999 },
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
