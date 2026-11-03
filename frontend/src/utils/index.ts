import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

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

export function getFileIcon(extension: string | null, type: 'file' | 'directory'): string {
  if (type === 'directory') return 'folder'

  const map: Record<string, string> = {
    // Video
    mp4: 'file-video', mkv: 'file-video', avi: 'file-video', mov: 'file-video',
    // Image
    jpg: 'file-image', jpeg: 'file-image', png: 'file-image', gif: 'file-image', webp: 'file-image',
    // Code
    ts: 'file-code-2', tsx: 'file-code-2', js: 'file-code-2', jsx: 'file-code-2',
    py: 'file-code-2', sh: 'file-code-2', json: 'file-code-2', yaml: 'file-code-2',
    // Config
    conf: 'file-cog', service: 'file-cog', env: 'file-cog', toml: 'file-cog', ini: 'file-cog',
    // Text
    txt: 'file-text', md: 'file-text', log: 'file-text',
    // Archive
    zip: 'file-archive', tar: 'file-archive', gz: 'file-archive', rar: 'file-archive',
    // PDF
    pdf: 'file-type',
  }

  const ext = extension?.replace('.', '') || ''
  return map[ext] || 'file'
}

export function getColorVar(color: string): string {
  const map: Record<string, string> = {
    blue:   'var(--blue)',
    green:  'var(--green)',
    orange: 'var(--orange)',
    red:    'var(--red)',
    purple: 'var(--purple)',
    teal:   'var(--teal)',
    yellow: 'var(--yellow)',
  }
  return map[color] || 'var(--text3)'
}

export function getDimVar(color: string): string {
  const map: Record<string, string> = {
    blue:   'var(--blue-dim)',
    green:  'var(--green-dim)',
    orange: 'var(--orange-dim)',
    red:    'var(--red-dim)',
    purple: 'var(--purple-dim)',
    teal:   'var(--teal-dim)',
    yellow: 'var(--yellow-dim)',
  }
  return map[color] || 'var(--surface3)'
}
