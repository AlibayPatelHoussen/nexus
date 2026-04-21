import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B'
  const k     = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i     = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)

  if (d > 0) return `${d}j ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
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
