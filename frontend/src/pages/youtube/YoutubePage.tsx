import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Youtube } from 'lucide-react'
import { mediaService } from '@/services/mediaService'
import type { MediaItem } from '@/types'
import Page from '@/components/shell/Page'
import { useShell } from '@/components/shell/shellContext'
import SegmentedControl from '@/components/ui/SegmentedControl'
import Toggle from '@/components/ui/Toggle'
import EmptyState from '@/components/ui/EmptyState'
import Skeleton from '@/components/ui/Skeleton'
import Artwork from '@/components/media/Artwork'
import { VideoSectionSwitch } from '@/components/media/MediaBrowser'
import { formatDuration } from '@/pages/downloads/SearchView'
import DownloadsButton from '@/components/downloads/DownloadsButton'

type Sort = 'recent' | 'title'
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] max-sm:grid-cols-1 gap-x-4 gap-y-6'

/** "il y a 3 j", like the TV app */
function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return 'à l’instant'
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  if (s < 86400 * 30) return `il y a ${Math.floor(s / 86400)} j`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

function VideoTile({ v, progress }: { v: MediaItem; progress?: number }) {
  const navigate = useNavigate()
  return (
    <button type="button" className="group flex flex-col self-start text-left min-w-0 press-soft rounded-[10px]" onClick={() => navigate(`/player/${v.id}`)} aria-label={v.title}>
      <Artwork src={v.posterPath} alt="" ratio="16 / 9" type="youtube" title={v.title} cover
        className="w-full rounded-[10px] transition-transform duration ease-out lg:group-hover:scale-[1.02]">
        {v.duration ? (
          <span className="absolute right-1.5 bottom-1.5 px-1.5 py-[1px] rounded-[4px] text-[11px] font-semibold text-white tabular" style={{ background: 'rgba(0,0,0,.75)' }}>
            {formatDuration(v.duration)}
          </span>
        ) : null}
        {progress ? (
          <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: 'rgba(255,255,255,.35)' }}>
            <span className="block h-full" style={{ width: `${Math.min(100, progress)}%`, background: 'var(--red)' }} />
          </span>
        ) : null}
      </Artwork>
      <span className="block mt-2 text-subhead font-medium text-label line-clamp-2">{v.title}</span>
      <span className="block mt-0.5 text-caption text-label2 truncate">{[v.channel, ago(v.createdAt)].filter(Boolean).join(' · ')}</span>
    </button>
  )
}

/** Médias › YouTube: the videos of /media/youtube, newest first, optionally by channel. */
export default function YoutubePage() {
  const { device } = useShell()
  const phone = device === 'phone'
  const [sort, setSort] = useState<Sort>('recent')
  const [byChannel, setByChannel] = useState(false)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['media', 'catalog', 'youtube'],
    queryFn: () => mediaService.getAll({ type: 'youtube', limit: 1000, sortBy: 'created_at', sortDir: 'desc' }),
  })
  const { data: watching } = useQuery({ queryKey: ['media', 'continue'], queryFn: mediaService.getContinueWatching })
  const progress = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of watching ?? []) if (w.duration) m.set(w.id, (w.progress / w.duration) * 100)
    return m
  }, [watching])

  const videos = useMemo(() => {
    const list = [...(data?.items ?? [])]
    if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title, 'fr'))
    return list
  }, [data, sort])
  const groups = useMemo(() => {
    const g = new Map<string, MediaItem[]>()
    for (const v of videos) {
      const k = v.channel || 'Autres vidéos'
      g.set(k, [...(g.get(k) ?? []), v])
    }
    return [...g.entries()].sort((a, b) => (a[0] === 'Autres vidéos' ? 1 : b[0] === 'Autres vidéos' ? -1 : a[0].localeCompare(b[0], 'fr')))
  }, [videos])

  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedControl<Sort> label="Tri" value={sort} onChange={setSort}
        options={[{ value: 'recent', label: 'Récents' }, { value: 'title', label: 'Titre' }]} />
      <label className="inline-flex items-center gap-2 text-subhead text-label">
        <Toggle checked={byChannel} onChange={setByChannel} label="Grouper par chaîne" />
        Par chaîne
      </label>
    </div>
  )

  let body: React.ReactNode
  if (isError) {
    body = <EmptyState tone="error" icon={<AlertTriangle strokeWidth={1.25} />} title="Vidéos indisponibles" message="Le serveur n’a pas répondu." />
  } else if (isLoading) {
    body = <div className={GRID}>{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-video rounded-[10px]" />)}</div>
  } else if (!videos.length) {
    body = <EmptyState icon={<Youtube strokeWidth={1.25} />} title="Aucune vidéo"
      message="Les vidéos téléchargées depuis Téléchargements, ou placées dans /media/youtube, apparaîtront ici." />
  } else if (byChannel) {
    body = (
      <div className="flex flex-col gap-8">
        {groups.map(([channel, list]) => (
          <section key={channel} aria-label={channel}>
            <h2 className="text-headline text-label mb-3">{channel} <span className="text-label2 font-normal tabular">{list.length}</span></h2>
            <div className={GRID}>{list.map((v) => <VideoTile key={v.id} v={v} progress={progress.get(v.id)} />)}</div>
          </section>
        ))}
      </div>
    )
  } else {
    body = <div className={GRID}>{videos.map((v) => <VideoTile key={v.id} v={v} progress={progress.get(v.id)} />)}</div>
  }

  return (
    <Page title={phone ? 'Médias' : 'YouTube'} actions={phone ? <DownloadsButton /> : undefined}
      subtitle={!phone && data ? `${data.total ?? videos.length} vidéo${(data.total ?? videos.length) > 1 ? 's' : ''}` : undefined}
      accessory={phone ? <div className="flex flex-col gap-3"><VideoSectionSwitch full value="youtube" />{controls}</div>
        : <div className="flex flex-wrap items-center gap-4"><VideoSectionSwitch value="youtube" />{controls}</div>}>
      {body}
    </Page>
  )
}
