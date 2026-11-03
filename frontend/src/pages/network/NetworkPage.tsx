import { WifiOff } from 'lucide-react'
import { useSystemStats } from '@/hooks/useSocket'
import { useStatsHistory } from '@/hooks/useStatsHistory'
import { formatBytes, formatRate, formatUptime } from '@/utils'
import Page from '@/components/shell/Page'
import { Group, ListRow } from '@/components/ui/GroupedList'
import StatSparkline from '@/components/ui/StatSparkline'
import { SkeletonRows } from '@/components/ui/Skeleton'
import EmptyState from '@/components/ui/EmptyState'

const last = (a: number[]) => (a.length ? a[a.length - 1] : 0)

export default function NetworkPage() {
  const { stats, connected } = useSystemStats()
  const history = useStatsHistory(stats)
  const online = stats?.network.status === 'online'

  return (
    <Page title="Réseau" subtitle={stats ? `${stats.network.interface || 'Interface inconnue'} · ${stats.network.ip || 'pas d’adresse'}` : undefined} narrow>
      {!stats && !connected ? (
        <EmptyState icon={<WifiOff strokeWidth={1.25} />} title="Connexion au serveur" message="Les informations arrivent dès que la connexion est établie." />
      ) : (
        <div className="flex flex-col gap-8 max-w-[760px] mx-auto">
          <section aria-label="Débit" className="bg-surface rounded-card p-4">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 mb-3 tabular">
              <p><span className="text-subhead text-label2">Reçu </span><span className="text-[22px] font-semibold tracking-[-0.02em] text-label">{formatRate(last(history.down))}</span></p>
              <p><span className="text-subhead text-label2">Envoyé </span><span className="text-[22px] font-semibold tracking-[-0.02em] text-label">{formatRate(last(history.up))}</span></p>
            </div>
            <StatSparkline values={history.down} secondary={history.up} height={72} label="Débit reçu (bleu) et envoyé (gris), 3 dernières minutes" />
            <p className="text-caption text-label2 mt-2">3 dernières minutes · bleu : reçu, gris : envoyé</p>
          </section>

          <Group header="Connexion">
            {!stats ? <SkeletonRows rows={4} /> : (
              <>
                <ListRow title="État" status={online ? 'ok' : 'error'} detail={online ? 'En ligne' : 'Hors ligne'} />
                <ListRow title="Interface" detail={<span className="font-mono">{stats.network.interface || '—'}</span>} />
                <ListRow title="Adresse IP locale" detail={<span className="font-mono">{stats.network.ip || '—'}</span>} />
                <ListRow title="Reçu depuis le démarrage" detail={formatBytes(stats.network.rx)} />
                <ListRow title="Envoyé depuis le démarrage" detail={formatBytes(stats.network.tx)} />
              </>
            )}
          </Group>

          <Group header="Système">
            {!stats ? <SkeletonRows rows={4} /> : (
              <>
                <ListRow title="Nom de la machine" detail={stats.os.hostname} />
                <ListRow title="Système" detail={`${stats.os.distro} ${stats.os.release}`} />
                <ListRow title="Architecture" detail={stats.os.arch} />
                <ListRow title="En ligne depuis" detail={formatUptime(stats.uptime)} />
              </>
            )}
          </Group>
        </div>
      )}
    </Page>
  )
}
