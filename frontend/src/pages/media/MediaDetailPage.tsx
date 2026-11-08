import FollowGroup from '@/components/downloads/FollowGroup'
import { useState } from 'react'
import { useFavorites } from '@/hooks/useFavorites'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Play, Plus, RotateCw, Star, Tv } from 'lucide-react'
import MediaRow from '@/components/media/MediaRow'
import DetailHero from '@/components/media/DetailHero'
import Artwork from '@/components/media/Artwork'
import Skeleton from '@/components/ui/Skeleton'
import ChaptersSection from '@/components/media/ChaptersSection'
import { mediaService } from '@/services/mediaService'
import { formatDuration, formatBytes, statusLabel } from '@/utils'
import EpisodesSection from '@/components/media/EpisodesSection'
import type { Episode, Chapter, MediaItem } from '@/types'
import toast from 'react-hot-toast'
import Page from '@/components/shell/Page'
import { useShell } from '@/components/shell/shellContext'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { Group, ListRow } from '@/components/ui/GroupedList'
import { useAuthStore } from '@/stores/authStore'
import { rating } from '@/components/media/mediaActions'
import { cn } from '@/utils'

/** Where the back button leads (the library of this kind of title) */
function libraryOf(type?: MediaItem['type']): { to: string; label: string } {
  switch (type) {
    case 'serie': return { to: '/cinema?type=series', label: 'Séries' }
    case 'anime': return { to: '/animes', label: 'Animes' }
    case 'manga': case 'webtoon': return { to: '/manga', label: 'Manga' }
    default: return { to: '/cinema', label: 'Films' }
  }
}

export default function MediaDetailPage() {
  const { id }     = useParams<{ id: string }>()
  const navigate   = useNavigate()
  const qc         = useQueryClient()
  const favorites = useFavorites()
  const isFav = id ? favorites.isFav(id) : null
  const { device } = useShell()
  const phone = device === 'phone'
  const isAdmin = useAuthStore((st) => st.user?.role === 'admin')
  const [activeSeason, setActiveSeason] = useState<number | null>(null)
  const [scanning, setScanning] = useState(false)

  const { data: media, isLoading, isError, refetch, isPlaceholderData } = useQuery({
    queryKey: ['media', id],
    queryFn:  () => mediaService.getById(id!),
    enabled:  !!id,
    // The card that was clicked already knows title and artwork: show them at once
    // (the poster grows into the header), the rest arrives with the request
    placeholderData: () => {
      for (const [, data] of qc.getQueriesData<{ items?: MediaItem[] }>({ queryKey: ['media'] })) {
        const hit = data?.items?.find?.((m) => m.id === id)
        if (hit) return { ...hit, episodes: undefined, chapters: undefined } as MediaItem
      }
      return undefined
    },
  })

  const isShowType = (t?: string) => t === 'serie' || t === 'anime'

  const { data: episodesProgress = [] } = useQuery({
    queryKey: ['episodes-progress', id],
    queryFn:  () => mediaService.getEpisodesProgress(id!),
    enabled:  !!id,
  })

  const { data: progress } = useQuery({
    queryKey: ['progress', id],
    queryFn:  () => mediaService.getProgress(id!),
    enabled:  !!id,
  })

  // "More like this": same type, sharing the main genre
  const { data: similarData } = useQuery({
    queryKey: ['media', 'similar', id, media?.type, media?.genres?.[0]],
    queryFn:  () => mediaService.getAll({ type: media!.type, genre: media!.genres[0], limit: 25, sortBy: 'rating', sortDir: 'desc' }),
    enabled:  !!media?.genres?.length,
  })
  const similar = (similarData?.items ?? []).filter((m) => m.id !== id).slice(0, 20)


  async function scan() {
    setScanning(true)
    try {
      const scanType = media?.type === 'serie' ? 'series' : media?.type === 'anime' ? 'animes' : 'manga'
      await mediaService.scan(scanType)
      toast.success('Analyse lancée : la page se met à jour dans quelques secondes.')
      setTimeout(() => qc.invalidateQueries({ queryKey: ['media', id] }), 4000)
    } catch { toast.error('L’analyse n’a pas pu démarrer.') }
    finally { setScanning(false) }
  }

  if (isLoading) {
    return (
      <Page title="" back={libraryOf()} largeTitle={false}>
        <div className="flex flex-col gap-4" aria-label="Chargement">
          <Skeleton className="w-full aspect-video max-h-[60vh] rounded-card" />
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </Page>
    )
  }

  if (!media) {
    return (
      <Page title={isError ? 'Erreur' : 'Introuvable'} back={libraryOf()}>
        <EmptyState
          tone={isError ? 'error' : 'neutral'}
          icon={<AlertTriangle strokeWidth={1.25} />}
          title={isError ? 'Impossible de charger ce titre' : 'Titre introuvable'}
          message={isError ? 'Le serveur n’a pas répondu correctement. Réessaie dans un instant.' : 'Il a peut-être été retiré de la bibliothèque.'}
          action={
            <div className="flex gap-2 justify-center">
              <Button onClick={() => navigate(-1)}>Retour</Button>
              {isError && <Button variant="primary" onClick={() => refetch()}>Réessayer</Button>}
            </div>
          }
        />
      </Page>
    )
  }

  const episodes: Episode[] = media.episodes || []
  const chapters: Chapter[] = media.chapters  || []
  const seasons  = [...new Set(episodes.map((e) => e.season ?? 1))].sort((a, b) => a - b)
  const isReading = ['manga', 'webtoon'].includes(media.type)
  const isShow    = isShowType(media.type)

  // Streaming-style "next up": resume the last episode in progress, or the one
  // after the last finished episode, otherwise the first episode
  const progressByEpisode = new Map(episodesProgress.map((p) => [p.episodeId, p]))
  const lastWatched = episodesProgress[0]
  const lastIndex   = lastWatched ? episodes.findIndex((e) => e.id === lastWatched.episodeId) : -1
  const nextEpisode = lastIndex === -1
    ? episodes[0]
    : lastWatched.completed ? (episodes[lastIndex + 1] ?? episodes[lastIndex]) : episodes[lastIndex]
  const nextProgress = nextEpisode ? progressByEpisode.get(nextEpisode.id) : undefined
  const nextResumes  = !!nextProgress && !nextProgress.completed && nextProgress.progress > 30
  const currentSeason = activeSeason ?? nextEpisode?.season ?? seasons[0] ?? 1

  const resumeEpisode = nextEpisode

  const progressPct = progress && progress.duration
    ? Math.round((progress.progress / progress.duration) * 100)
    : 0

  function play(episodeId?: string, chapterId?: string, version?: string) {
    if (isReading) {
      const chapId = chapterId || chapters[0]?.id
      if (!chapId) { toast.error('Aucun chapitre : lance une analyse.'); return }
      navigate(`/reader/${id}?ch=${chapId}${version ? `&lang=${encodeURIComponent(version)}` : ''}`)
    } else if (isShow) {
      // A series is never played as a whole: always open a specific episode
      const epId = episodeId || resumeEpisode?.id || episodes[0]?.id
      if (!epId) { toast.error('Aucun épisode : lance une analyse.'); return }
      navigate(`/player/${id}?ep=${epId}`)
    } else {
      navigate(`/player/${id}`)
    }
  }

  const typeLabel: Record<string, string> = {
    film: 'Film', serie: 'Série', anime: 'Anime', manga: 'Manga', webtoon: 'Webtoon',
  }

  const seasonsCount = seasons.length
  const metaBits = [
    typeLabel[media.type],
    media.year ? String(media.year) : null,
    isShow && seasonsCount ? `${seasonsCount} saison${seasonsCount > 1 ? 's' : ''}` : null,
    isShow && episodes.length ? `${episodes.length} épisode${episodes.length > 1 ? 's' : ''}` : null,
    !isShow && media.duration ? formatDuration(media.duration) : null,
    isReading && chapters.length ? `${chapters.length} chapitre${chapters.length > 1 ? 's' : ''}` : null,
  ].filter(Boolean) as string[]
  const r = rating(media.rating)

  const playLabel = isShow
    ? episodes.length === 0
      ? 'Aucun épisode'
      : episodesProgress.length === 0 && nextEpisode?.id === episodes[0]?.id
        ? 'Lire le premier épisode'
        : `${nextResumes ? 'Reprendre' : 'Lire'} · S${nextEpisode?.season ?? 1} É${nextEpisode?.episodeNumber}`
    : isReading
      ? chapters.length === 0 ? 'Aucun chapitre' : 'Lire'
      : progress && progressPct > 0 && progressPct < 95
        ? `Reprendre · ${progressPct} %`
        : 'Lecture'
  const canPlay = !((isShow && episodes.length === 0) || (isReading && chapters.length === 0))

  const scanButton = isAdmin && (isReading || isShow) && (
    phone ? (
      <button type="button" className="w-11 h-11 grid place-items-center rounded-full text-label active:opacity-50 disabled:opacity-40" onClick={scan} disabled={scanning} aria-label="Analyser à nouveau" title="Analyser à nouveau">
        <RotateCw size={22} strokeWidth={1.75} className={scanning ? 'animate-spin' : ''} />
      </button>
    ) : (
      <Button icon={<RotateCw size={14} strokeWidth={1.75} className={scanning ? 'animate-spin' : ''} />} disabled={scanning} onClick={scan}>
        Analyser à nouveau
      </Button>
    )
  )

  return (
    <Page
      title={media.title}
      subtitle={metaBits.join(' · ')}
      back={libraryOf(media.type)}
      actions={scanButton}
      largeTitle={false}
      hero={isReading ? undefined : (
        <DetailHero
          media={media}
          facts={metaBits}
          rating={r}
          playLabel={playLabel}
          canPlay={canPlay}
          onPlay={() => play()}
          isFav={isFav}
          onFav={() => favorites.toggle(media)}
          favBusy={favorites.busy}
          upNext={nextEpisode && isShow && episodesProgress.length > 0 ? `S${nextEpisode.season ?? 1}, É${nextEpisode.episodeNumber}${nextEpisode.title ? ` · ${nextEpisode.title}` : ''}` : null}
        />
      )}
    >
      {/* ── Manga / webtoon (Apple Books until step 5): the cover whole, details beside it ── */}
      {isReading && (
      <section className={cn('flex gap-6 lg:gap-8 mb-8', phone ? 'flex-col items-center text-center' : 'items-start')}>
        <Artwork
          src={media.posterPath || media.backdropPath}
          alt={media.title}
          ratio={media.posterPath || !media.backdropPath ? '2 / 3' : '16 / 9'}
          type={media.type}
          title={media.title}
          subtitle={media.year}
          loading="eager"
          className={cn('flex-shrink-0 rounded-[6px] shadow-[0_14px_34px_-10px_rgba(0,0,0,0.45)]', media.posterPath || !media.backdropPath
            ? 'w-[52vw] max-w-[220px] md:w-[200px] lg:w-[240px] md:max-w-none'
            : 'w-full max-w-[420px] md:w-[360px]')}
        />
        <div className={cn('min-w-0 flex-1 flex flex-col gap-2', phone && 'items-center w-full')}>
          <p className="text-subhead text-label2">{metaBits.join(' · ')}</p>
          <h2 className="text-[28px] md:text-[34px] font-bold tracking-[-0.022em] leading-tight text-label break-words text-balance">{media.title}</h2>
          {media.originalTitle && media.originalTitle !== media.title && <p className="text-subhead text-label2">{media.originalTitle}</p>}
          {r && (
            <p className="flex items-center gap-1 text-subhead text-label2 tabular">
              <Star size={13} strokeWidth={1.75} aria-hidden="true" /> {r} / 10
              {media.voteCount ? <span>· {media.voteCount.toLocaleString('fr-FR')} votes</span> : null}
            </p>
          )}
          <div className={cn('flex gap-2 mt-3', phone ? 'flex-col w-full' : 'flex-wrap')}>
            <Button variant="primary" size={phone ? 'large' : 'regular'} icon={<Play size={14} strokeWidth={0} fill="currentColor" />} onClick={() => play()} disabled={!canPlay}>
              {playLabel}
            </Button>
            <Button size={phone ? 'large' : 'regular'} icon={isFav ? <Check size={14} strokeWidth={2} /> : <Plus size={14} strokeWidth={2} />}
              onClick={() => favorites.toggle(media)} disabled={favorites.busy} aria-pressed={isFav === true}>
              Ma liste
            </Button>
          </div>
          {nextEpisode && isShow && (
            <p className="text-subhead text-label mt-4 font-medium">
              S{nextEpisode.season ?? 1}, É{nextEpisode.episodeNumber}{nextEpisode.title ? ` · ${nextEpisode.title}` : ''}
            </p>
          )}
          <p className={cn('text-callout text-label2 max-w-[68ch]', !(nextEpisode && isShow) && 'mt-4')} style={phone ? { textAlign: 'left', alignSelf: 'stretch' } : undefined}>
            {media.overview || 'Aucun synopsis disponible.'}
          </p>
        </div>
      </section>
      )}


      {/* Episodes (series / anime) */}
      {isShow && episodes.length > 0 && (
        <EpisodesSection
          episodes={episodes}
          seasons={seasons}
          activeSeason={currentSeason}
          onSeasonChange={setActiveSeason}
          progress={progressByEpisode}
          nextEpisodeId={nextEpisode?.id}
          onPlay={(epId) => play(epId)}
        />
      )}
      {isShow && episodes.length === 0 && !isPlaceholderData && (
        <section className="bg-surface rounded-card mb-10">
          <EmptyState
            icon={<Tv strokeWidth={1.25} />}
            title="Aucun épisode trouvé"
            message={<>Range les vidéos dans le dossier de la série (par exemple <span className="font-mono">Saison 1/S01E01.mkv</span>), puis lance une analyse.</>}
            action={<Button variant="primary" icon={<RotateCw size={14} strokeWidth={1.75} />} loading={scanning} onClick={scan}>Analyser les épisodes</Button>}
          />
        </section>
      )}

      {/* Chapters (manga / webtoon) */}
      {isReading && !isPlaceholderData && <ChaptersSection chapters={chapters} onRead={(chapterId, version) => play(undefined, chapterId, version)} onScan={scan} scanning={scanning} />}

      {/* Automatic downloads of what comes next (off unless switched on) */}
      {isAdmin && (media.type === 'anime' || media.type === 'serie' || media.type === 'manga' || media.type === 'webtoon') && (
        <div className="max-w-[640px] mb-10">
          <FollowGroup mediaId={media.id} kind={media.type === 'webtoon' ? 'manga' : media.type} />
        </div>
      )}

      {/* Information */}
      {(media.genres?.length > 0 || media.year || media.duration || media.status || media.language || media.fileSize) ? (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] mb-10">
        <Group header="Informations">
          {media.originalTitle && media.originalTitle !== media.title && <ListRow title="Titre original" detail={media.originalTitle} />}
          {media.genres?.length > 0 && <ListRow title="Genres" detail={media.genres.join(', ')} />}
          {media.year && <ListRow title="Année" detail={String(media.year)} />}
          {media.duration ? <ListRow title="Durée" detail={formatDuration(media.duration)} /> : null}
          {media.status && <ListRow title="Statut" detail={statusLabel(media.status)} />}
          {media.language && <ListRow title="Langue" detail={media.language.toUpperCase()} />}
          {media.fileSize && media.fileSize > 0 ? <ListRow title="Taille" detail={formatBytes(media.fileSize)} /> : null}
        </Group>
      </div>
      ) : null}

      {/* More like this */}
      {similar.length > 0 && <MediaRow title="Titres similaires" items={similar} />}
    </Page>
  )
}
