import { Tv } from 'lucide-react'
import MediaBrowser from '@/components/media/MediaBrowser'

export default function AnimesPage() {
  return (
    <MediaBrowser
      title="Animes"
      videoSwitch
      emptyIcon={<Tv strokeWidth={1.25} />}
      tabs={[{ key: 'animes', label: 'Animes', type: 'anime', scanType: 'animes', noun: 'un anime' }]}
    />
  )
}
