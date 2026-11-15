import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Our type scale (tailwind.config fontSize) must be known as font sizes,
// otherwise `text-body` is taken for a colour and drops `text-label`.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['largetitle', 'title', 'headline', 'body', 'callout', 'subhead', 'caption'] }],
      rounded: [{ rounded: ['card', 'group', 'control', 'sheet', 'glass', 'sidebar', 'pill'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const NUM = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })

/** 6,1 Go — French units (octets), one decimal. */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 o'
  const k     = 1024
  const sizes = ['o', 'Ko', 'Mo', 'Go', 'To', 'Po']
  const i     = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)))
  const v     = bytes / Math.pow(k, i)
  const fmt   = decimals === 1 ? NUM : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: decimals })
  return `${fmt.format(i === 0 ? Math.round(v) : v)}\u00a0${sizes[i]}`
}

// Status as TMDB, AniList and MangaDex give it, in French
const STATUS: Record<string, string> = {
  ongoing: 'En cours', releasing: 'En cours', 'returning series': 'En cours', 'in production': 'En production',
  completed: 'Terminé', finished: 'Terminé', ended: 'Terminé', released: 'Sorti',
  hiatus: 'En pause', cancelled: 'Annulé', canceled: 'Annulé',
  not_yet_released: 'À venir', planned: 'Prévu', 'post production': 'Post-production', rumored: 'Annoncé',
}

/** « ongoing » / « RELEASING » / « Returning Series » → « En cours »; unknown values unchanged */
export function statusLabel(status: string): string {
  return STATUS[status.trim().toLowerCase()] ?? status
}

/** Transfer rate: 2,4 Mo/s */
export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

/** 6 j 4 h, 3 h 12 min, 8 min */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}\u00a0j ${h}\u00a0h`
  if (h > 0) return `${h}\u00a0h ${m}\u00a0min`
  return `${m}\u00a0min`
}

/** 23 % */
export function formatPercent(value: number): string {
  return `${Math.round(value)}\u00a0%`
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-CA', {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
  })
}

/** « 15 nov. 2027 » */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** « à l’instant », « il y a 5 min », « il y a 3 h », « hier à 21:04 », « 12 nov. à 10:02 », « 12 nov. 2025 » */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const s = Math.round((now.getTime() - d.getTime()) / 1000)
  if (s < 60) return 'à l’instant'
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86_400_000)
  if (days === 0) return s < 6 * 3600 ? `il y a ${Math.floor(s / 3600)} h` : `aujourd’hui à ${time}`
  if (days === 1) return `hier à ${time}`
  if (d.getFullYear() === now.getFullYear()) return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${time}`
  return formatDay(iso)
}
