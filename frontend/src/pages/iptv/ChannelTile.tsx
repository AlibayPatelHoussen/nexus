import { memo, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Heart, Tv } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/utils'
import { iptvService, type IptvChannel } from '@/services/iptvService'
import { categoryName, flag } from './labels'

/** Where the player finds the previous / next channel: the list the channel was opened from */
const QUEUE_KEY = 'nexus-iptv-queue'
export function rememberQueue(ids: string[]) {
  try { sessionStorage.setItem(QUEUE_KEY, JSON.stringify(ids.slice(0, 2000))) } catch { /* storage off */ }
}
export function readQueue(): string[] {
  try { return JSON.parse(sessionStorage.getItem(QUEUE_KEY) || '[]') as string[] } catch { return [] }
}

export function useOpenChannel() {
  const navigate = useNavigate()
  return (channel: IptvChannel, list: IptvChannel[]) => {
    rememberQueue(list.map((c) => c.id))
    navigate(`/iptv/watch/${encodeURIComponent(channel.id)}`)
  }
}

/** Add / remove a favourite; every list showing the channel is refreshed */
export function useToggleFavorite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (c: IptvChannel) => (c.favorite ? iptvService.removeFavorite(c.id) : iptvService.addFavorite(c.id)),
    onSuccess: (_r, c) => {
      toast.success(c.favorite ? 'Retirée des favoris' : 'Ajoutée aux favoris')
      void qc.invalidateQueries({ queryKey: ['iptv'] })
    },
    onError: () => toast.error('Impossible de modifier les favoris'),
  })
}

/** The logo on a neutral plate (logos are drawn for any background); a TV glyph without logo */
export function ChannelLogo({ channel, className }: { channel: Pick<IptvChannel, 'logo' | 'name'>; className?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [channel.logo])
  return (
    <span className={cn('relative grid place-items-center overflow-hidden bg-fill', className)}>
      {channel.logo && !failed ? (
        <img
          src={channel.logo}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="max-w-[72%] max-h-[64%] object-contain"
        />
      ) : (
        <span className="flex flex-col items-center gap-1 px-2 text-label3" aria-hidden="true">
          <Tv size={26} strokeWidth={1.5} />
          <span className="text-caption font-semibold text-label2 line-clamp-2 text-center">{channel.name}</span>
        </span>
      )}
    </span>
  )
}

export function StatusDot({ channel }: { channel: Pick<IptvChannel, 'status' | 'statusReason'> }) {
  if (channel.status === 'unknown') return null
  const on = channel.status === 'online'
  return (
    <span
      className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', on ? 'bg-ok' : 'bg-label3')}
      role="img"
      aria-label={on ? 'Disponible (vérifiée)' : `Indisponible${channel.statusReason ? ` : ${channel.statusReason}` : ''}`}
      title={on ? 'Disponible (vérifiée)' : `Indisponible${channel.statusReason ? ` — ${channel.statusReason}` : ''}`}
    />
  )
}

/** Channel tile (Apple TV « Live TV » style): logo plate, name, country / category, status */
export const ChannelTile = memo(function ChannelTile({ channel, onOpen, compact }: {
  channel: IptvChannel; onOpen: (c: IptvChannel) => void; compact?: boolean
}) {
  const fav = useToggleFavorite()
  const meta = [channel.country ? `${flag(channel.country)} ${channel.country}` : null, channel.categories[0] ? categoryName(channel.categories[0]) : null]
    .filter(Boolean).join(' · ')
  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        onClick={() => onOpen(channel)}
        className="block w-full text-left rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={`Regarder ${channel.name}`}
      >
        <ChannelLogo channel={channel} className={cn('w-full aspect-video rounded-card transition-transform duration-fast ease-out group-active:scale-[0.97]', compact && 'aspect-[16/10]')} />
        <span className="mt-2 flex items-center gap-1.5 min-w-0">
          <StatusDot channel={channel} />
          <span className="text-subhead font-semibold text-label truncate">{channel.name}</span>
        </span>
        {!compact && meta && <span className="block text-caption text-label2 truncate">{meta}</span>}
      </button>
      <button
        type="button"
        onClick={() => fav.mutate(channel)}
        disabled={fav.isPending}
        className={cn(
          'absolute top-1.5 right-1.5 w-11 h-11 grid place-items-center rounded-full transition-opacity',
          channel.favorite ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100',
        )}
        aria-label={channel.favorite ? `Retirer ${channel.name} des favoris` : `Ajouter ${channel.name} aux favoris`}
        aria-pressed={channel.favorite}
      >
        <span className="w-8 h-8 grid place-items-center rounded-full glass-over-art">
          <Heart size={16} strokeWidth={2} className={channel.favorite ? 'fill-danger text-danger' : ''} />
        </span>
      </button>
    </div>
  )
})

export const CHANNEL_GRID = 'grid gap-x-4 gap-y-5 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'

/** Calls `onMore` when the end of the list comes into view (progressive loading) */
export function useInfiniteTrigger(onMore: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onMore)
  cb.current = onMore
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) cb.current() }, { rootMargin: '800px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [enabled])
  return ref
}
