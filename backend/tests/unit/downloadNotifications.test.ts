import { message, versionLabel } from '../../src/services/downloadNotifications'
import type { DownloadRow } from '../../src/services/downloads'

const row = (over: Partial<DownloadRow>): DownloadRow => ({
  id: 'x', kind: 'film', source_script: 'oxtorrent', source_id: 'oxtorrent:film:1', title: 'Deadpool & Wolverine', poster_url: null,
  options: {}, selection: {}, status: 'done', progress: {}, dest_path: null, error: null, created_by: null,
  created_at: '', started_at: null, finished_at: null, updated_at: '', ...over,
})

describe('download notifications', () => {
  it('« Film terminé — <titre> · 1080p MULTI », whatever the source', () => {
    expect(message(row({ options: { version: { label: '1080p MULTI' } } as DownloadRow['options'] })))
      .toEqual({ ok: true, title: 'Film terminé', body: 'Deadpool & Wolverine · 1080p MULTI' })
    // Torrent queued before versions were stored: read from the release name
    expect(versionLabel(row({ progress: { item: 'Deadpool.And.Wolverine.2024.Internal.Multi.Vf2.WEBRIP.1080p' } }))).toBe('1080p MULTI')
    expect(message(row({ kind: 'anime', source_script: 'anisama', title: 'One Piece', options: { lang: 'VOSTFR' }, selection: { episodes: [3, 1, 2] } })))
      .toEqual({ ok: true, title: 'Épisodes terminés', body: 'One Piece · épisodes 1–3 · VOSTFR' })
    expect(message(row({ kind: 'manga', source_script: 'anisama', title: 'Naruto', options: { lang: 'VF' }, selection: { chapters: [700] } })).body)
      .toBe('Naruto · chapitre 700 · VF')
    // anime-sama editions: « VFNB » = VF, black & white
    expect(message(row({ kind: 'manga', source_script: 'anisama', title: 'One Piece', options: { lang: 'VFNB' }, selection: { chapters: [1] } })).body)
      .toBe('One Piece · chapitre 1 · VF noir et blanc')
    expect(message(row({ kind: 'youtube', source_script: 'youtube', title: 'Vidéo' })).title).toBe('Vidéo terminée')
  })

  it('says why it failed', () => {
    expect(message(row({ status: 'failed', source_script: 'movix', title: 'Série', kind: 'serie', options: { lang: 'VF' }, selection: { episodes: [1] }, error: 'Pas disponible en VF' })))
      .toEqual({ ok: false, title: 'Échec du téléchargement', body: 'Série · épisode 1 · VF — Pas disponible en VF' })
  })
})
