import type { DownloadKind } from '@/services/downloadsService'
import { cn } from '@/utils'

export const KIND_LABEL: Record<DownloadKind, string> = {
  anime: 'Animé/Série', manga: 'Manga', film: 'Film', serie: 'Série', youtube: 'YouTube',
}

// One discreet system colour per type
const TONE: Record<DownloadKind, [string, string]> = {
  anime:   ['var(--purple-text)', 'var(--purple-soft)'],
  manga:   ['var(--orange-text)', 'var(--orange-soft)'],
  film:    ['var(--accent-text)', 'var(--accent-soft)'],
  serie:   ['var(--green-text)', 'var(--green-soft)'],
  youtube: ['var(--red-text)', 'var(--red-soft)'],
}

export default function KindBadge({ kind, className }: { kind: DownloadKind; className?: string }) {
  const [color, background] = TONE[kind]
  return (
    <span className={cn('inline-flex items-center h-[18px] px-1.5 rounded-[5px] text-[11px] font-semibold tracking-[0.01em] whitespace-nowrap', className)}
      style={{ color, background }}>
      {KIND_LABEL[kind]}
    </span>
  )
}
