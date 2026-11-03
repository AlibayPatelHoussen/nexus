import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Activity, Folder, Wifi, WifiOff, Zap } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useSystemStats } from '@/hooks/useSocket'
import { useStatsHistory, type StatsHistory } from '@/hooks/useStatsHistory'
import { servicesService } from '@/services/systemService'
import { formatBytes, formatPercent, formatRate, formatUptime } from '@/utils'
import Page from '@/components/shell/Page'
import { useShell } from '@/components/shell/shellContext'
import { Group, ListRow } from '@/components/ui/GroupedList'
import StatSparkline, { CapacityBar } from '@/components/ui/StatSparkline'
import Skeleton, { SkeletonRows } from '@/components/ui/Skeleton'
import EmptyState from '@/components/ui/EmptyState'
import type { ServiceInfo, SystemStats } from '@/types'

const last = (a: number[]) => (a.length ? a[a.length - 1] : 0)

export default function DashboardPage() {
  const { device } = useShell()
  const phone = device === 'phone'
  const { stats, connected } = useSystemStats()
  const history = useStatsHistory(stats)
  const { data: services, isError: servicesError } = useQuery({
    queryKey: ['services'],
    queryFn:  servicesService.getAll,
    refetchInterval: 10_000,
  })

  const subtitle = stats
    ? `${stats.os.hostname} · en ligne depuis ${formatUptime(stats.uptime)}`
    : connected ? 'Réception des mesures…' : 'Connexion au serveur…'

  return (
    <Page title={phone ? 'Aperçu' : 'Vue d’ensemble'} subtitle={subtitle}>
      {!stats && !connected ? (
        <Connecting />
      ) : phone ? (
        <PhoneOverview stats={stats} history={history} services={services} servicesError={servicesError} />
      ) : (
        <DesktopOverview stats={stats} history={history} services={services} servicesError={servicesError} />
      )}
    </Page>
  )
}

interface OverviewProps {
  stats:    SystemStats | null
  history:  StatsHistory
  services: ServiceInfo[] | undefined
  servicesError: boolean
}

function Connecting() {
  return (
    <EmptyState
      icon={<WifiOff strokeWidth={1.25} />}
      title="Connexion au serveur"
      message="Les mesures en direct arrivent dès que la connexion est établie. Si rien ne change, vérifie que le serveur Nexus tourne."
    />
  )
}

/* ── Desktop: Activity Monitor panel, then lists ─────────────────────────── */

function DesktopOverview({ stats, history, services, servicesError }: OverviewProps) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Activité" className="grid grid-cols-2 xl:grid-cols-4 gap-px bg-separator rounded-card overflow-hidden">
        <Meter label="Processeur" value={stats ? formatPercent(stats.cpu.usage) : null}
          detail={stats ? `${stats.cpu.cores} cœurs${stats.temperature != null ? ` · ${stats.temperature} °C` : ''}` : null}
          warn={stats?.temperature != null && stats.temperature >= 80}>
          <StatSparkline values={history.cpu} max={100} label="Utilisation du processeur, 3 dernières minutes" />
        </Meter>
        <Meter label="Mémoire" value={stats ? formatBytes(stats.memory.used) : null}
          detail={stats ? `sur ${formatBytes(stats.memory.total)}` : null}>
          <StatSparkline values={history.mem} max={100} label="Utilisation de la mémoire, 3 dernières minutes" />
        </Meter>
        <Meter label="Stockage" value={stats ? formatBytes(stats.disk.used) : null}
          detail={stats ? `sur ${formatBytes(stats.disk.total)}` : null}>
          <div className="h-[44px] flex flex-col justify-end gap-1.5">
            {stats && <CapacityBar percent={stats.disk.usedPercent} label="Espace disque utilisé" />}
            {stats && <p className="text-caption text-label2 tabular">{formatBytes(stats.disk.free)} disponibles</p>}
          </div>
        </Meter>
        <Meter label="Réseau" value={stats ? `↓ ${formatRate(last(history.down))}` : null}
          detail={stats ? `↑ ${formatRate(last(history.up))}` : null}>
          <StatSparkline values={history.down} secondary={history.up} label="Débit réseau reçu et envoyé, 3 dernières minutes" />
        </Meter>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
        <ServicesGroup services={services} error={servicesError} />
        <div className="flex flex-col gap-6 min-w-0">
          <MediaStorage stats={stats} />
          <SystemInfo stats={stats} />
        </div>
      </div>
    </div>
  )
}

function Meter({ label, value, detail, warn, children }: { label: string; value: string | null; detail: string | null; warn?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 p-4 min-w-0 bg-surface">
      <h3 className="text-subhead text-label2">{label}</h3>
      {value == null ? (
        <Skeleton className="h-6 w-24 my-0.5" />
      ) : (
        <p className="tabular leading-tight">
          <span className="text-[22px] font-semibold tracking-[-0.02em] text-label">{value}</span>
          {detail && <span className={warn ? 'ml-1.5 text-subhead text-warn-text' : 'ml-1.5 text-subhead text-label2'}>{detail}</span>}
        </p>
      )}
      <div className="mt-2">{children}</div>
    </div>
  )
}

/* ── Phone: grouped lists, rows with chevrons ───────────────────────────── */

function PhoneOverview({ stats, history, services, servicesError }: OverviewProps) {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const stopped = services?.filter((s) => s.status !== 'active').length ?? 0
  return (
    <div className="flex flex-col gap-8">
      <Group>
        <PhoneMeter label="Processeur" value={stats ? formatPercent(stats.cpu.usage) : null}>
          <StatSparkline values={history.cpu} max={100} height={26} capacity={30} label="Processeur" />
        </PhoneMeter>
        <PhoneMeter label="Mémoire" value={stats ? formatPercent(stats.memory.usedPercent) : null}>
          <StatSparkline values={history.mem} max={100} height={26} capacity={30} label="Mémoire" />
        </PhoneMeter>
        <PhoneMeter label="Stockage" value={stats ? formatPercent(stats.disk.usedPercent) : null}>
          {stats && <CapacityBar percent={stats.disk.usedPercent} label="Espace disque utilisé" />}
        </PhoneMeter>
        <PhoneMeter label="Réseau" value={stats ? formatRate(last(history.down)) : null}>
          <StatSparkline values={history.down} secondary={history.up} height={26} capacity={30} label="Débit réseau" />
        </PhoneMeter>
      </Group>

      <Group header="Serveur">
        {isAdmin && <ListRow to="/files" icon={<Folder strokeWidth={1.75} />} iconTone="accent" title="Fichiers" accessory="chevron" />}
        <ListRow to="/services" icon={<Activity strokeWidth={1.75} />} iconTone="accent" title="Services"
          detail={servicesError ? 'Indisponible' : services ? (stopped ? `${stopped} arrêté${stopped > 1 ? 's' : ''}` : 'Tous actifs') : ''} accessory="chevron" />
        {isAdmin && <ListRow to="/scripts" icon={<Zap strokeWidth={1.75} />} iconTone="accent" title="Scripts" accessory="chevron" />}
        <ListRow to="/network" icon={<Wifi strokeWidth={1.75} />} iconTone="accent" title="Réseau" detail={stats?.network.ip} accessory="chevron" />
      </Group>

      <MediaStorage stats={stats} />
      <SystemInfo stats={stats} />
    </div>
  )
}

function PhoneMeter({ label, value, children }: { label: string; value: string | null; children: React.ReactNode }) {
  return (
    <div role="listitem" className="nx-row relative flex items-center gap-3 px-4 min-h-row">
      <span className="w-[92px] flex-shrink-0 text-label">{label}</span>
      <span className="flex-1 min-w-0 flex items-center [&>*]:w-full">{children}</span>
      <span className="w-[86px] flex-shrink-0 text-right text-label2 tabular">{value ?? '—'}</span>
    </div>
  )
}

/* ── Shared groups ───────────────────────────────────────────────────────── */

function ServicesGroup({ services, error }: { services: ServiceInfo[] | undefined; error: boolean }) {
  return (
    <Group header="Services" action={<Link to="/services" className="text-subhead text-accent-text hover:underline">Tout gérer</Link>}>
      {error ? (
        <EmptyState className="py-8" title="Services indisponibles" message="Le serveur n’a pas répondu. Réessaie dans un instant." />
      ) : !services ? (
        <SkeletonRows rows={4} />
      ) : services.length === 0 ? (
        <EmptyState className="py-8" title="Aucun service suivi" message="Ajoute des services dans la configuration du serveur pour les voir ici." />
      ) : (
        services.map((s) => (
          <ListRow
            key={s.name}
            to="/services"
            status={s.status === 'active' ? 'ok' : s.status === 'failed' ? 'error' : 'off'}
            title={s.displayName}
            detail={s.status === 'active' ? 'Actif' : s.status === 'failed' ? 'En échec' : s.status === 'inactive' ? 'Arrêté' : 'État inconnu'}
          />
        ))
      )}
    </Group>
  )
}

function MediaStorage({ stats }: { stats: SystemStats | null }) {
  const ms = stats?.mediaStorage
  const rows = ms ? [
    { label: 'Films', bytes: ms.films },
    { label: 'Séries', bytes: ms.series },
    { label: 'Animes', bytes: ms.animes },
    { label: 'Manga', bytes: ms.manga },
  ] : []
  return (
    <Group header="Bibliothèque" footer={stats ? `${formatBytes(stats.disk.free)} disponibles sur ${formatBytes(stats.disk.total)}` : undefined}>
      {!stats ? <SkeletonRows rows={4} /> : rows.map((r) => (
        <ListRow key={r.label} title={r.label} detail={r.bytes ? formatBytes(r.bytes) : 'Vide'} />
      ))}
    </Group>
  )
}

function SystemInfo({ stats }: { stats: SystemStats | null }) {
  return (
    <Group header="Système">
      {!stats ? <SkeletonRows rows={4} /> : (
        <>
          <ListRow title="Nom" detail={stats.os.hostname} />
          <ListRow title="Système" detail={`${stats.os.distro} ${stats.os.release}`} />
          <ListRow title="Processeur" detail={stats.cpu.model} />
          <ListRow title="Adresse IP" detail={stats.network.ip || '—'} />
        </>
      )}
    </Group>
  )
}
