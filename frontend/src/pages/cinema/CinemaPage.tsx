import { Film, Tv } from 'lucide-react'
import MediaBrowser from '@/components/media/MediaBrowser'

export default function CinemaPage() {
  return (
    <MediaBrowser
      title="Cinéma"
      yearFilter
      tabs={[
        { key: 'films',  label: 'Films',  icon: <Film size={13} strokeWidth={2} />, type: 'film',  scanType: 'films',  noun: 'un film' },
        { key: 'series', label: 'Séries', icon: <Tv   size={13} strokeWidth={2} />, type: 'serie', scanType: 'series', noun: 'une série' },
      ]}
    />
  )
}
