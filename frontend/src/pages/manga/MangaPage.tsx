import { BookOpen } from 'lucide-react'
import MediaBrowser from '@/components/media/MediaBrowser'

export default function MangaPage() {
  return (
    <MediaBrowser
      title="Manga"
      emptyIcon={<BookOpen strokeWidth={1.25} />}
      tabs={[{ key: 'manga', label: 'Manga', type: 'manga', scanType: 'manga', noun: 'un manga' }]}
    />
  )
}
