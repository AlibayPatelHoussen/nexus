import { BookOpen } from 'lucide-react'
import MediaBrowser from '@/components/media/MediaBrowser'

export default function MangaPage() {
  return (
    <MediaBrowser
      title="Manga"
      emptyIcon={<BookOpen size={48} strokeWidth={1} style={{ color: 'var(--text3)' }} />}
      tabs={[{ key: 'manga', label: 'Manga', type: 'manga', scanType: 'manga', noun: 'un manga' }]}
    />
  )
}
