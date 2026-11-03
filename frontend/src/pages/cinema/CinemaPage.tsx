import { Film } from 'lucide-react'
import MediaBrowser from '@/components/media/MediaBrowser'

export default function CinemaPage() {
  return (
    <MediaBrowser
      title="Films et séries"
      yearFilter
      videoSwitch
      emptyIcon={<Film strokeWidth={1.25} />}
      tabs={[
        { key: 'films',  label: 'Films',  type: 'film',  scanType: 'films',  noun: 'un film' },
        { key: 'series', label: 'Séries', type: 'serie', scanType: 'series', noun: 'une série' },
      ]}
    />
  )
}
