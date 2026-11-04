import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { downloadsService } from '@/services/downloadsService'
import { useDownloadsSocket } from '@/hooks/useDownloadsSocket'
import Page from '@/components/shell/Page'
import { useShell } from '@/components/shell/shellContext'
import SegmentedControl from '@/components/ui/SegmentedControl'
import SearchView from './SearchView'
import QueueView from './QueueView'

type Tab = 'search' | 'queue'

/** « Téléchargements »: one search over the four scripts, and the queue. */
export default function DownloadsPage() {
  const { device } = useShell()
  const phone = device === 'phone'
  const socket = useDownloadsSocket()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'queue' ? 'queue' : 'search'
  const setTab = (t: Tab) => setParams(t === 'search' ? {} : { tab: t }, { replace: true })
  const { data } = useQuery({ queryKey: ['downloads'], queryFn: downloadsService.list, refetchInterval: 30_000 })
  const active = (data ?? []).filter((d) => d.status === 'running' || d.status === 'queued').length

  const tabs = (
    <SegmentedControl<Tab> label="Section" value={tab} onChange={setTab} full={phone}
      options={[
        { value: 'search', label: 'Rechercher' },
        { value: 'queue', label: <>File d’attente{active ? <span className="ml-1 tabular text-accent-text">{active}</span> : null}</> },
      ]} />
  )

  return (
    <Page title="Téléchargements" subtitle={!phone ? 'Animes, mangas, films, séries et vidéos YouTube' : undefined}
      actions={!phone ? tabs : undefined} accessory={phone ? tabs : undefined}>
      {tab === 'search' ? <SearchView socket={socket} /> : <QueueView onSearch={() => setTab('search')} />}
    </Page>
  )
}
