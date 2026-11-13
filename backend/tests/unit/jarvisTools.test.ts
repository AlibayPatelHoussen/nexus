jest.mock('../../src/config/database', () => ({ query: jest.fn() }))
jest.mock('../../src/services/downloads', () => ({
  createDownload: jest.fn(async (input: { title: string }) => ({ id: 'job-1', title: input.title })),
  getDetails: jest.fn(),
  listDownloads: jest.fn(),
  actOn: jest.fn(async () => ({ title: 'Dune', status: 'paused' })),
}))
jest.mock('../../src/services/downloadScripts', () => ({
  ...jest.requireActual('../../src/services/downloadScripts'),
  collect: jest.fn(),
}))
jest.mock('../../src/services/iptv', () => ({
  ...jest.requireActual('../../src/services/iptv'),
  listChannels: jest.fn(),
  getChannel: jest.fn(),
  addFavorite: jest.fn(),
  removeFavorite: jest.fn(),
}))
jest.mock('../../src/services/libraryDelete', () => ({ deleteMediaEverywhere: jest.fn() }))

import { query } from '../../src/config/database'
import { collect } from '../../src/services/downloadScripts'
import { createDownload, getDetails, listDownloads } from '../../src/services/downloads'
import { addFavorite, getChannel, listChannels } from '../../src/services/iptv'
import { manifest, parseNumbers, resolveUser, runTool } from '../../src/services/jarvisTools'

const mQuery = query as jest.Mock
const mCollect = collect as jest.Mock
const mCreate = createDownload as jest.Mock
const mDetails = getDetails as jest.Mock

const ADMIN = { id: '11111111-1111-1111-1111-111111111111', username: 'houssen', role: 'admin' }
const USER = { id: '22222222-2222-2222-2222-222222222222', username: 'alice', role: 'user' }

/** The users table answers for these accounts; other queries return no rows. */
function users(...accounts: typeof ADMIN[]) {
  mQuery.mockImplementation(async (sql: string, params: unknown[]) => {
    if (/FROM users WHERE lower\(username\)/.test(sql)) return { rows: accounts.filter((a) => a.username === params[0]) }
    if (/FROM users WHERE id/.test(sql)) return { rows: accounts.filter((a) => a.id === params[0]) }
    return { rows: [] }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.JARVIS_OWNER = 'Houssen'
  users(ADMIN, USER)
})

describe('parseNumbers', () => {
  const available = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12]
  it('reads single numbers, ranges, lists and « tout »', () => {
    expect(parseNumbers('3', available)).toEqual([3])
    expect(parseNumbers('1-5, 8', available)).toEqual([1, 2, 3, 4, 5, 8])
    expect(parseNumbers('8–12', available)).toEqual([8, 10, 12])
    expect(parseNumbers('tout', available)).toEqual(available)
    expect(parseNumbers('', available)).toEqual(available)
    expect(parseNumbers('1050.5', [])).toEqual([1050.5])
  })
  it('refuses nonsense', () => {
    expect(() => parseNumbers('les premiers', available)).toThrow(/Liste invalide/)
    expect(() => parseNumbers('1-99999', [])).toThrow(/trop grande/)
  })
})

describe('manifest', () => {
  it('describes every tool with roles and confirmation', () => {
    const m = manifest()
    const byName = Object.fromEntries(m.tools.map((t) => [t.name, t]))
    expect(m.name).toBe('Nexus')
    expect(byName.nexus_telecharger.roles).toEqual(['admin'])
    expect(byName.nexus_bibliotheque.roles).toEqual(['admin', 'user'])
    expect(byName.nexus_supprimer_media.confirm).toBe(true)
    expect(byName.nexus_telecharger.confirm).toBe(false)
    for (const t of m.tools) {
      expect(t.name).toMatch(/^nexus_[a-z_]+$/)
      expect(t.parameters.type).toBe('object')
      for (const r of t.parameters.required) expect(t.parameters.properties).toHaveProperty(r)
    }
  })
})

describe('users and rights', () => {
  it('maps the Jarvis owner to JARVIS_OWNER and checks the role in the database', async () => {
    expect(await resolveUser('owner')).toEqual(ADMIN)
    expect(await resolveUser(USER.id)).toEqual(USER)
    await expect(resolveUser('inconnu')).rejects.toThrow(/inconnu/)
    delete process.env.JARVIS_OWNER
    await expect(resolveUser('owner')).rejects.toThrow(/JARVIS_OWNER/)
  })

  it('keeps downloads for admins', async () => {
    expect(await runTool('nexus_telecharger', { id: 'movix:movie:1' }, USER.id))
      .toMatch(/réservée aux administrateurs/)
    expect(mCreate).not.toHaveBeenCalled()
  })

  it('turns validation errors into a sentence for the model', async () => {
    expect(await runTool('nexus_telecharger', { id: 'pas-un-id' }, 'owner')).toBe('Erreur : Identifiant de média invalide')
    await expect(runTool('nexus_inexistant', {}, 'owner')).rejects.toThrow(/not found/)
  })
})

describe('downloads', () => {
  it('searches every source, filters by type and remembers titles', async () => {
    mCollect.mockImplementation(async (source: string) => ({ events: source === 'anisama'
      ? [{ type: 'result', id: 'anisama:anime:one-piece', source, kind: 'anime', title: 'One Piece', poster_url: 'https://img/op.jpg', langs: ['VOSTFR', 'VF'], seasons: [{ id: 'saison1', label: 'Saison 1' }] },
         { type: 'result', id: 'anisama:manga:one-piece', source, kind: 'manga', title: 'One Piece', langs: ['VF'] }]
      : source === 'movix' ? [{ type: 'error', message: 'site injoignable' }] : [] }))
    const out = await runTool('nexus_chercher_telechargement', { recherche: 'One Piece', type: 'anime' }, 'owner')
    expect(mCollect).toHaveBeenCalledTimes(5)
    expect(out).toContain('One Piece · anime · langues VOSTFR/VF · 1 saison(s) · id anisama:anime:one-piece')
    expect(out).not.toContain('anisama:manga')
  })

  it('downloads anime episodes: season, VOSTFR by default, ranges', async () => {
    mDetails.mockResolvedValue({ title: 'One Piece', seasons: [
      { id: 'saison1', lang: 'VF', label: 'Saison 1', episodes: [{ n: 1 }, { n: 2 }] },
      { id: 'saison1', lang: 'VOSTFR', label: 'Saison 1', episodes: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4, available: false }] },
      { id: 'saison2', lang: 'VOSTFR', label: 'Saison 2', episodes: [{ n: 1 }] },
    ] })
    const out = await runTool('nexus_telecharger', { id: 'anisama:anime:one-piece', saison: '1', episodes: 'tout' }, 'owner')
    expect(out).toBe('« One Piece » — Saison 1 (VOSTFR) : 3 épisode(s) ajouté(s) à la file.')
    expect(mCreate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'anisama:anime:one-piece', season: 'saison1', lang: 'VOSTFR', episodes: [1, 2, 3], force: false,
    }), ADMIN.id)

    await runTool('nexus_telecharger', { id: 'anisama:anime:one-piece', saison: 'saison1', langue: 'vf', episodes: '2' }, 'owner')
    expect(mCreate).toHaveBeenLastCalledWith(expect.objectContaining({ season: 'saison1', lang: 'VF', episodes: [2] }), ADMIN.id)

    expect(await runTool('nexus_telecharger', { id: 'anisama:anime:one-piece', saison: '9' }, 'owner'))
      .toMatch(/Saison « 9 » introuvable/)
  })

  it('downloads manga chapters from the chosen edition', async () => {
    mDetails.mockResolvedValue({ title: 'One Piece', langs: [
      { lang: 'VFCO', label: 'Couleur', chapters: [{ n: 1 }, { n: 2 }] },
      { lang: 'VF', label: 'VF', chapters: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 1100 }] },
    ] })
    const out = await runTool('nexus_telecharger', { id: 'anisama:manga:one-piece', chapitres: '2-3, 1100' }, 'owner')
    expect(out).toBe('« One Piece » : 3 chapitre(s) ajouté(s) à la file (VF).')
    expect(mCreate).toHaveBeenLastCalledWith(expect.objectContaining({ lang: 'VF', chapters: [2, 3, 1100] }), ADMIN.id)
  })

  it('picks a good torrent version for a film', async () => {
    mCollect.mockImplementation(async (source: string) => ({ events: source === 'oxtorrent' ? [{
      type: 'result', id: 'oxtorrent:film:9', source, kind: 'film', title: 'Dune', versions: [
        { id: 'oxtorrent:film:101', resolution: '720p', language: 'FRENCH', language_family: 'VF', size: '2 Go', size_bytes: 2e9, seeders: 50 },
        { id: 'oxtorrent:film:102', resolution: '1080p', language: 'MULTI', language_family: 'MULTI', size: '8 Go', size_bytes: 8e9, seeders: 40 },
        { id: 'oxtorrent:film:103', resolution: '1080p', language: 'MULTI', language_family: 'MULTI', size: '9 Go', size_bytes: 9e9, seeders: 0 },
      ] }] : [] }))
    await runTool('nexus_chercher_telechargement', { recherche: 'Dune' }, 'owner')
    const out = await runTool('nexus_telecharger', { id: 'oxtorrent:film:9' }, 'owner')
    expect(out).toBe('« Dune » ajouté à la file (1080p · MULTI · 8 Go).')
    expect(mCreate).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'oxtorrent:film:102', item: 'oxtorrent:film:9', version: { resolution: '1080p', language: 'MULTI' },
    }), ADMIN.id)
  })

  it('lists the queue', async () => {
    (listDownloads as jest.Mock).mockResolvedValue([
      { id: 'a', title: 'One Piece', status: 'running', progress: { index: 2, total: 12, percent: 41.6 }, error: null, options: { season: 'saison1' } },
      { id: 'b', title: 'Dune', status: 'failed', progress: {}, error: 'Site injoignable', options: {} },
    ])
    expect(await runTool('nexus_telechargements', {}, 'owner')).toBe(
      '- One Piece (saison1) · en cours · 2/12 · 42 % · id a\n- Dune · échoué · Site injoignable · id b')
    expect(await runTool('nexus_gerer_telechargement', { id: 'b', action: 'pause' }, 'owner')).toBe('« Dune » : mis en pause.')
  })
})

describe('IPTV', () => {
  it('finds a channel, gives its player link, adds it to favourites', async () => {
    (listChannels as jest.Mock).mockResolvedValue({ total: 1, items: [{ id: 'TF1.fr', name: 'TF1', country: 'FR', status: 'online', favorite: false }] })
    ;(getChannel as jest.Mock).mockResolvedValue({ id: 'TF1.fr', name: 'TF1', status: 'online' })
    expect(await runTool('nexus_chercher_chaine', { recherche: 'tf1' }, USER.id)).toBe('- TF1 (FR) · en ligne · id TF1.fr')
    expect(listChannels).toHaveBeenCalledWith(USER.id, expect.objectContaining({ q: 'tf1' }))
    expect(await runTool('nexus_ouvrir_chaine', { id: 'TF1.fr' }, USER.id)).toBe('Lien : /iptv/watch/TF1.fr — TF1.')
    expect(await runTool('nexus_favori_chaine', { id: 'TF1.fr' }, USER.id)).toBe('TF1 ajoutée aux favoris.')
    expect(addFavorite).toHaveBeenCalledWith(USER.id, 'TF1.fr')
  })
})

describe('manga editions', () => {
  it('honours an explicit edition and says which exist', async () => {
    mDetails.mockResolvedValue({ title: 'One Piece', langs: [
      { lang: 'VFCO', chapters: [{ n: 1 }, { n: 2 }] }, { lang: 'VF', chapters: [{ n: 1 }] }] })
    await runTool('nexus_telecharger', { id: 'anisama:manga:one-piece', chapitres: '1-2', langue: 'vfco' }, 'owner')
    expect(mCreate).toHaveBeenLastCalledWith(expect.objectContaining({ lang: 'VFCO', chapters: [1, 2] }), ADMIN.id)
    expect(await runTool('nexus_telecharger', { id: 'anisama:manga:one-piece', langue: 'EN' }, 'owner'))
      .toBe('Pas d’édition EN. Éditions : VFCO, VF')
  })
})
