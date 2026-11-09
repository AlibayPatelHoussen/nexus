import { useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { spring } from '@/design/motion'
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
import { SectionMenu } from '@/components/media/PhoneLibraryBar'
import { formatDuration } from '@/pages/downloads/SearchView'
import DownloadsButton from '@/components/downloads/DownloadsButton'
import { useAutoScan } from '@/hooks/useAutoScan'

type Sort = 'recent' | 'title'
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] max-sm:grid-cols-1 gap-x-5 gap-y-7'

/** "il y a 3 j", like the TV app */
function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return 'à l’instant'
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  if (s < 86400 * 30) return `il y a ${Math.floor(s / 86400)} j`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Apple TV style video card: 16:9 still, lift + reflection on hover, duration in a glass capsule. */
function VideoTile({ v, progress }: { v: MediaItem; progress?: number }) {
  const navigate = useNavigate()
  const ref = useRef<HTMLButtonElement>(null)
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el || e.pointerType !== 'mouse') return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`)
    el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`)
  }
  return (
    <motion.button
      ref={ref}
      type="button"
      className="no-press group flex flex-col self-start text-left min-w-0 snap-start rounded-card"
      onClick={() => navigate(`/player/${v.id}`)}
      onPointerMove={onMove}
      whileHover={{ scale: 1.035, y: -2 }} whileFocus={{ scale: 1.035 }} whileTap={{ scale: 0.97 }}
      transition={spring.lift}
      aria-label={v.title}
    >
      <Artwork src={v.posterPath} alt="" ratio="16 / 9" type="youtube" title={v.title} cover
        className="w-full rounded-card transition-shadow duration-300 group-hover:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.55)]">
        <span className="absolute inset-0 rounded-card pointer-events-none shadow-[inset_0_0_0_1px_var(--poster-rim)]" aria-hidden="true" />
        <span className="absolute inset-0 rounded-card pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{ background: 'radial-gradient(circle at var(--mx, 50%) var(--my, 0%), rgba(255,255,255,0.26), rgba(255,255,255,0.05) 38%, transparent 62%)' }} aria-hidden="true" />
        {v.duration ? (
          <span className="absolute right-2 bottom-2 px-2 py-0.5 rounded-pill text-[11px] font-semibold tabular glass-media">
            {formatDuration(v.duration)}
          </span>
        ) : null}
        {progress ? (
          <span className="absolute left-2.5 right-16 bottom-3 h-[3px] rounded-full overflow-hidden bg-white/35">
            <span className="block h-full rounded-full bg-white" style={{ width: `${Math.min(100, progress)}%` }} />
          </span>
        ) : null}
      </Artwork>
      <span className="block mt-2.5 px-0.5 text-subhead font-semibold text-label line-clamp-2">{v.title}</span>
      <span className="block mt-0.5 px-0.5 text-caption text-label2 truncate">{[v.channel, ago(v.createdAt)].filter(Boolean).join(' · ')}</span>
    </motion.button>
  )
}

/** Médias › YouTube: the videos of /media/youtube, newest first, optionally by channel. */
export default function YoutubePage() {
  useAutoScan('youtube')
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
    body = <div className={GRID}>{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-video rounded-card" />)}</div>
  } else if (!videos.length) {
    body = <EmptyState icon={<Youtube strokeWidth={1.25} />} title="Aucune vidéo"
      message="Les vidéos téléchargées depuis Téléchargements, ou placées dans /media/youtube, apparaîtront ici." />
  } else if (byChannel) {
    body = (
      // One Apple TV shelf per channel
      <div className="flex flex-col">
        {groups.map(([channel, list]) => (
          <section key={channel} aria-label={channel} className="shelf shelf--wide">
            <h2 className="shelf__title text-[17px] md:text-[19px] font-bold text-label">{channel} <span className="text-label2 font-normal tabular">{list.length}</span></h2>
            <div className="shelf__scroller scrollbar-none">{list.map((v) => <VideoTile key={v.id} v={v} progress={progress.get(v.id)} />)}</div>
          </section>
        ))}
      </div>
    )
  } else {
    body = <div className={GRID}>{videos.map((v) => <VideoTile key={v.id} v={v} progress={progress.get(v.id)} />)}</div>
  }

  return (
    <Page title="YouTube" actions={phone ? <DownloadsButton /> : undefined}
      largeTitle={!phone} barTitle={!phone}
      leading={phone ? <SectionMenu value="youtube" /> : undefined}
      subtitle={!phone && data ? `${data.total ?? videos.length} vidéo${(data.total ?? videos.length) > 1 ? 's' : ''}` : undefined}
      accessory={phone ? controls
        : <div className="flex flex-wrap items-center gap-4"><VideoSectionSwitch value="youtube" />{controls}</div>}>
      {body}
    </Page>
  )
}
