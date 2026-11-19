import fs from 'fs'
import os from 'os'
import path from 'path'
import request from 'supertest'
import { app } from '../../src/index'
import { query } from '../../src/config/database'
import {
  applyRenames, episodeName, planRenames, renameAfterDownload, safeName, setRenameSettings, titleFolder, undoRenames, versionOf,
} from '../../src/services/renamer'
import { FIXTURES, makeToken } from '../helpers'

const admin = { Authorization: `Bearer ${makeToken('admin')}` }
const user = { Authorization: `Bearer ${makeToken('user')}` }

let ROOT: string
let FILMS: string
let SERIES: string
let ANIMES: string
const env = { films: process.env.FILMS_PATH, series: process.env.SERIES_PATH, animes: process.env.ANIMES_PATH }

/** A file written long ago (a file just written is left alone: a download may be writing it) */
function write(f: string, content = 'x') {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, content)
  const old = new Date(Date.now() - 3600_000)
  fs.utimesSync(f, old, old)
}
const has = (f: string) => fs.existsSync(f)

async function item(type: string, filePath: string, title: string, year: number | null, tmdbId: number | null, kind: string | null = null) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO media_items (type, title, file_path, year, tmdb_id, tmdb_kind) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [type, title, filePath, year, tmdbId, kind])
  return rows[0].id
}
async function episode(mediaId: string, file: string, season: number | null, n: number) {
  const { rows } = await query<{ id: string }>(
    'INSERT INTO episodes (media_item_id, season, episode_number, file_path) VALUES ($1, $2, $3, $4) RETURNING id', [mediaId, season, n, file])
  return rows[0].id
}
const pathOf = async (table: string, id: string) => (await query<{ file_path: string }>(`SELECT file_path FROM ${table} WHERE id = $1`, [id])).rows[0]?.file_path

beforeEach(async () => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-rename-'))
  FILMS = path.join(ROOT, 'films'); SERIES = path.join(ROOT, 'series'); ANIMES = path.join(ROOT, 'animes')
  for (const d of [FILMS, SERIES, ANIMES]) fs.mkdirSync(d, { recursive: true })
  process.env.FILMS_PATH = FILMS; process.env.SERIES_PATH = SERIES; process.env.ANIMES_PATH = ANIMES
  await setRenameSettings(true)
})
afterEach(async () => {
  await query(`DELETE FROM media_items WHERE file_path LIKE $1 || '%'`, [ROOT])
  await query(`DELETE FROM media_renames WHERE from_path LIKE $1 || '%'`, [ROOT])
  fs.rmSync(ROOT, { recursive: true, force: true })
})
afterAll(() => {
  process.env.FILMS_PATH = env.films; process.env.SERIES_PATH = env.series; process.env.ANIMES_PATH = env.animes
})

describe('Jellyfin names', () => {
  it('names any system takes', () => {
    expect(safeName('Star Wars: Episode IV')).toBe('Star Wars - Episode IV')
    expect(safeName('What If…? / Le "film" <3>')).toBe('What If… Le film 3')
    expect(safeName('Titre.  ')).toBe('Titre')
    expect(safeName('..')).toBe('Sans titre')
    expect(titleFolder({ title: 'Inception', year: 2010, tmdbId: 27205 })).toBe('Inception (2010) [tmdbid-27205]')
    expect(titleFolder({ title: 'Sans année', year: null, tmdbId: null })).toBe('Sans année')
    expect(episodeName('One Piece', 1, 5)).toBe('One Piece S01E05')
    expect(episodeName('One Piece', 21, 1015)).toBe('One Piece S21E1015')
    expect(versionOf(path.join('VOSTFR', 'Saison 1', 'ep01.mp4'))).toBe('VOSTFR')
    expect(versionOf(path.join('Saison1_—_VF', 'ep01.mp4'))).toBe('VF')
    expect(versionOf('ep01.mp4')).toBeNull()
  })
})

describe('Films', () => {
  it('a release in the films folder: its own folder, its subtitles and hint follow, the row follows (progress kept)', async () => {
    const video = path.join(FILMS, 'Inception.2010.MULTi.1080p.BluRay.mkv')
    write(video); write(path.join(FILMS, 'Inception.2010.MULTi.1080p.BluRay.fr.srt'))
    write(path.join(FILMS, '.Inception.2010.MULTi.1080p.BluRay.mkv.nexus.json'), '{"tmdb_id":27205}')
    const id = await item('film', video, 'Inception', 2010, 27205)
    await query('INSERT INTO watch_history (user_id, media_item_id, progress) VALUES ($1, $2, 120)', [FIXTURES.admin.id, id])

    const plan = await planRenames()
    expect(plan.map((p) => path.relative(FILMS, p.to))).toEqual([path.join('Inception (2010) [tmdbid-27205]', 'Inception (2010).mkv')])
    const res = await applyRenames()
    expect(res.renamed).toHaveLength(1)
    const dir = path.join(FILMS, 'Inception (2010) [tmdbid-27205]')
    expect(fs.readdirSync(dir).sort()).toEqual(['.Inception (2010).mkv.nexus.json', 'Inception (2010).fr.srt', 'Inception (2010).mkv'])
    expect(has(video)).toBe(false)
    expect(await pathOf('media_items', id)).toBe(path.join(dir, 'Inception (2010).mkv'))
    expect((await query('SELECT progress FROM watch_history WHERE media_item_id = $1', [id])).rows[0].progress).toBe(120)
    // Done: nothing more to do
    expect(await planRenames()).toEqual([])
  })

  it('a language folder (movix) gives the version; a folder of its own is renamed with its extras', async () => {
    const vf = path.join(FILMS, 'VF', 'Titre_2020.mp4')
    write(vf)
    const a = await item('film', vf, 'Titre', 2020, 11)
    const own = path.join(FILMS, 'Old Name 1999', 'movie.mkv')
    write(own); write(path.join(FILMS, 'Old Name 1999', 'poster.jpg'))
    const b = await item('film', own, 'The Matrix', 1999, 603)
    await applyRenames()
    expect(await pathOf('media_items', a)).toBe(path.join(FILMS, 'Titre (2020) [tmdbid-11]', 'Titre (2020) - VF.mp4'))
    expect(has(path.join(FILMS, 'VF'))).toBe(false)                     // empty: removed
    const matrix = path.join(FILMS, 'The Matrix (1999) [tmdbid-603]')
    expect(fs.readdirSync(matrix).sort()).toEqual(['The Matrix (1999).mkv', 'poster.jpg'])
    expect(await pathOf('media_items', b)).toBe(path.join(matrix, 'The Matrix (1999).mkv'))
  })

  it('another version already has the name: « - 1080p » (Jellyfin versions); a file being written is left', async () => {
    const dir = path.join(FILMS, 'Dune (2021) [tmdbid-438631]')
    write(path.join(dir, 'Dune (2021).mkv'))
    await item('film', path.join(dir, 'Dune (2021).mkv'), 'Dune', 2021, 438631)
    const second = path.join(FILMS, 'Dune.2021.1080p.WEB.mkv')
    write(second)
    const b = await item('film', second, 'Dune', 2021, 438631)
    const fresh = path.join(FILMS, 'Fresh.2024.mkv')
    fs.writeFileSync(fresh, 'x')                                          // written just now
    await item('film', fresh, 'Fresh', 2024, 5)
    const res = await applyRenames()
    expect(await pathOf('media_items', b)).toBe(path.join(dir, 'Dune (2021) - 1080p.mkv'))
    expect(res.skipped).toEqual([expect.objectContaining({ title: 'Fresh', reason: 'encore en cours d’écriture' })])
    expect(has(fresh)).toBe(true)
  })
})

describe('Séries and animes', () => {
  it('Season folders and SxxEyy names; the old season folders go; the TMDB id is left for the scripts', async () => {
    const show = path.join(SERIES, 'Breaking.Bad.S01.1080p')
    write(path.join(show, 'Breaking.Bad.S01E01.1080p.mkv'))
    write(path.join(show, 'Breaking.Bad.S01E01.1080p.en.srt'))
    write(path.join(show, 'Saison 2', 'Episode 1.mp4'))
    const id = await item('serie', show, 'Breaking Bad', 2008, 1396)
    const e1 = await episode(id, path.join(show, 'Breaking.Bad.S01E01.1080p.mkv'), 1, 1)
    const e2 = await episode(id, path.join(show, 'Saison 2', 'Episode 1.mp4'), 2, 1)
    await query('INSERT INTO watch_history (user_id, media_item_id, episode_id, progress) VALUES ($1, $2, $3, 300)', [FIXTURES.admin.id, id, e2])

    await applyRenames()
    const to = path.join(SERIES, 'Breaking Bad (2008) [tmdbid-1396]')
    expect(await pathOf('media_items', id)).toBe(to)
    expect(await pathOf('episodes', e1)).toBe(path.join(to, 'Season 01', 'Breaking Bad S01E01.mkv'))
    expect(await pathOf('episodes', e2)).toBe(path.join(to, 'Season 02', 'Breaking Bad S02E01.mp4'))
    expect(has(path.join(to, 'Season 01', 'Breaking Bad S01E01.en.srt'))).toBe(true)
    expect(has(path.join(to, 'Saison 2'))).toBe(false)
    expect(JSON.parse(fs.readFileSync(path.join(to, '.nexus.json'), 'utf8')).tmdb_id).toBe(1396)
    expect((await query('SELECT progress FROM watch_history WHERE episode_id = $1', [e2])).rows[0].progress).toBe(300)
  })

  it('a folder a script made again (anime-sama) joins the title already renamed: episodes, history; its row goes', async () => {
    const kept = path.join(ANIMES, 'One Piece (1999) [tmdbid-37854]')
    write(path.join(kept, 'Season 01', 'One Piece S01E01.mp4'))
    const a = await item('anime', kept, 'One Piece', 1999, 37854, 'tv')
    await episode(a, path.join(kept, 'Season 01', 'One Piece S01E01.mp4'), 1, 1)
    const again = path.join(ANIMES, 'One_Piece')
    write(path.join(again, 'Saison1_—_VOSTFR', 'ep002.mp4'))
    const b = await item('anime', again, 'One Piece', 1999, 37854, 'tv')
    const e = await episode(b, path.join(again, 'Saison1_—_VOSTFR', 'ep002.mp4'), 1, 2)
    await query('INSERT INTO favorites (user_id, media_item_id) VALUES ($1, $2)', [FIXTURES.admin.id, b])

    const res = await applyRenames()
    expect(res.errors).toEqual([])
    expect(await pathOf('episodes', e)).toBe(path.join(kept, 'Season 01', 'One Piece S01E02.mp4'))
    expect((await query('SELECT media_item_id FROM episodes WHERE id = $1', [e])).rows[0].media_item_id).toBe(a)
    expect((await query('SELECT 1 FROM media_items WHERE id = $1', [b])).rows).toHaveLength(0)
    expect((await query('SELECT 1 FROM favorites WHERE media_item_id = $1', [a])).rows).toHaveLength(1)
    expect(has(again)).toBe(false)
  })

  it('an anime film: named like a film inside the animes folder', async () => {
    const dir = path.join(ANIMES, 'Kimi no Na wa')
    write(path.join(dir, 'Film', 'film.mp4'))
    const id = await item('anime', dir, 'Your Name.', 2016, 372058, 'movie')
    const e = await episode(id, path.join(dir, 'Film', 'film.mp4'), null, 1)
    await applyRenames()
    expect(await pathOf('episodes', e)).toBe(path.join(ANIMES, 'Your Name (2016) [tmdbid-372058]', 'Your Name (2016).mp4'))
  })

  it('a folder still being downloaded is left whole', async () => {
    const show = path.join(SERIES, 'Downloading')
    write(path.join(show, 'S01E01.mkv'))
    fs.writeFileSync(path.join(show, '.part-oxtorrent-1'), '')
    const id = await item('serie', show, 'Downloading', 2020, 9)
    await episode(id, path.join(show, 'S01E01.mkv'), 1, 1)
    const res = await applyRenames()
    expect(res.renamed).toEqual([])
    expect(res.skipped[0].reason).toBe('téléchargement en cours')
    expect(has(path.join(show, 'S01E01.mkv'))).toBe(true)
  })
})

describe('Undo, new downloads, the API', () => {
  it('« Annuler » puts a batch back: the files and the rows', async () => {
    const show = path.join(SERIES, 'Some.Show.S01')
    write(path.join(show, 'Some.Show.S01E02.mkv'))
    const id = await item('serie', show, 'Some Show', 2019, 77)
    const e = await episode(id, path.join(show, 'Some.Show.S01E02.mkv'), 1, 2)
    const film = path.join(FILMS, 'Film.2001.mkv')
    write(film)
    const f = await item('film', film, 'Film', 2001, 88)
    const { batch } = await applyRenames()
    expect(has(film)).toBe(false)
    const res = await undoRenames(batch)
    expect(res.failed).toBe(0)
    expect(has(path.join(show, 'Some.Show.S01E02.mkv'))).toBe(true)
    expect(has(film)).toBe(true)
    expect(await pathOf('media_items', id)).toBe(show)
    expect(await pathOf('episodes', e)).toBe(path.join(show, 'Some.Show.S01E02.mkv'))
    expect(await pathOf('media_items', f)).toBe(film)
    await expect(undoRenames(batch)).rejects.toThrow(/Rien à annuler/)
  })

  it('after a download: only its titles, and only with « auto » on', async () => {
    const a = path.join(FILMS, 'Downloaded.2022.mkv'); write(a)
    const b = path.join(FILMS, 'Other.2022.mkv'); write(b)
    await item('film', a, 'Downloaded', 2022, 1)
    await item('film', b, 'Other', 2022, 2)
    await setRenameSettings(false)
    await renameAfterDownload([a])
    expect(has(a)).toBe(true)
    await setRenameSettings(true)
    await renameAfterDownload([a])
    expect(has(path.join(FILMS, 'Downloaded (2022) [tmdbid-1]', 'Downloaded (2022).mkv'))).toBe(true)
    expect(has(b)).toBe(true)                                              // not this download's
  })

  it('admins only; a preview, a rename, the history, the setting', async () => {
    write(path.join(FILMS, 'Api.Film.2003.mkv'))
    await item('film', path.join(FILMS, 'Api.Film.2003.mkv'), 'Api Film', 2003, 3)
    expect((await request(app).get('/api/library/rename/plan').set(user)).status).toBe(403)
    const plan = await request(app).get('/api/library/rename/plan').set(admin)
    expect(plan.body.data.titles).toEqual([expect.objectContaining({ title: 'Api Film', from: 'Api.Film.2003.mkv', to: 'Api Film (2003).mkv', files: 1 })])
    expect((await request(app).get('/api/library/rename/plan').query({ type: 'nope' }).set(admin)).status).toBe(422)
    const done = await request(app).post('/api/library/rename/apply').set(admin).send({})
    expect(done.body.data.renamed).toHaveLength(1)
    const history = await request(app).get('/api/library/rename/history').set(admin)
    expect(history.body.data[0]).toMatchObject({ batch: done.body.data.batch, titles: 1, files: 1, undone: false })
    expect((await request(app).get('/api/library/rename/settings').set(admin)).body.data).toEqual({ auto: true })
    expect((await request(app).put('/api/library/rename/settings').set(admin).send({ auto: false })).body.data).toEqual({ auto: false })
    expect((await request(app).put('/api/library/rename/settings').set(admin).send({ auto: 'yes' })).status).toBe(422)
    expect((await request(app).post('/api/library/rename/undo/not-a-batch').set(admin)).status).toBe(404)
  })
})
