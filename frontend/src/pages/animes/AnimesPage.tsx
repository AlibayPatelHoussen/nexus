import { Tv2 } from 'lucide-react'
import MediaBrowser from '@/components/media/MediaBrowser'

export default function AnimesPage() {
  return (
    <MediaBrowser
      title="Animes"
      emptyIcon={<Tv2 size={48} strokeWidth={1} style={{ color: 'var(--text3)' }} />}
      tabs={[{ key: 'animes', label: 'Animes', type: 'anime', scanType: 'animes', noun: 'un anime' }]}
    />
  )
}
