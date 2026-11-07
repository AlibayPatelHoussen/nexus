import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Activity, ExternalLink, RotateCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { servicesService } from '@/services/systemService'
import type { ServiceInfo } from '@/types'
import Page from '@/components/shell/Page'
import { useShell } from '@/components/shell/shellContext'
import { Group, ListRow } from '@/components/ui/GroupedList'
import Button from '@/components/ui/Button'
import Sheet from '@/components/ui/Sheet'
import EmptyState from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useConfirm } from '@/components/ui/useConfirm'
import { cn, formatBytes, formatUptime } from '@/utils'
import { useAuthStore } from '@/stores/authStore'
import { SERVICE_STATE as STATE, isInstalled, isRunning, isStopped } from '@/services/serviceState'

const summary = (list: ServiceInfo[]) => {
  const on = list.filter(isRunning).length
  const off = list.filter(isStopped).length
  const missing = list.filter((s) => !isInstalled(s)).length
  return [`${on} actif${on > 1 ? 's' : ''}`, `${off} arrêté${off > 1 ? 's' : ''}`, missing ? `${missing} non installé${missing > 1 ? 's' : ''}` : '']
    .filter(Boolean).join(' · ')
}

export default function ServicesPage() {
  const qc = useQueryClient()
  const { device } = useShell()
  const phone = device === 'phone'
  const [selected, setSelected] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)

  const { data: services = [], isLoading, isError, isFetching } = useQuery({
    queryKey: ['services'],
    queryFn:  servicesService.getAll,
    refetchInterval: 10_000,
  })
  useEffect(() => {
    if (!phone && !selected && services.length) setSelected(services[0].name)
  }, [phone, selected, services])

  // Installed services first, the missing ones at the end
  const sorted = [...services].sort((a, b) => Number(!isInstalled(a)) - Number(!isInstalled(b)))
  const current = services.find((s) => s.name === selected)
  const refresh = (
    <button type="button" className={phone ? 'w-11 h-11 grid place-items-center text-accent-text active:opacity-50' : 'w-8 h-8 grid place-items-center rounded-full text-label2 hoverable'}
      onClick={() => qc.invalidateQueries({ queryKey: ['services'] })} aria-label="Actualiser" title="Actualiser">
      <RotateCw size={phone ? 22 : 16} strokeWidth={phone ? 1.75 : 1.5} className={isFetching ? 'animate-spin' : ''} />
    </button>
  )

  const list = isLoading ? <SkeletonRows rows={5} /> : (
    <Group footer={services.length ? summary(services) : undefined}>
      {sorted.map((s) => (
        <ListRow
          key={s.name}
          status={STATE[s.status].dot}
          title={<span className={isInstalled(s) ? undefined : 'text-label2'}>{s.displayName}</span>}
          subtitle={!phone ? undefined : s.description}
          detail={<span className={s.status === 'failed' ? 'text-danger-text' : undefined}>{STATE[s.status].label}</span>}
          selected={!phone && s.name === selected}
          accessory={phone ? 'chevron' : undefined}
          onClick={() => { setSelected(s.name); if (phone) setSheet(true) }}
        />
      ))}
    </Group>
  )

  return (
    <Page title="Services" subtitle={services.length ? summary(services) : undefined} actions={refresh}>
      {isError ? (
        <EmptyState tone="error" icon={<Activity strokeWidth={1.25} />} title="Services indisponibles" message="Le serveur n’a pas répondu. Réessaie dans un instant." />
      ) : !isLoading && services.length === 0 ? (
        <EmptyState icon={<Activity strokeWidth={1.25} />} title="Aucun service suivi" message="Ajoute des services dans la configuration du serveur pour les gérer ici." />
      ) : phone ? (
        <>
          {list}
          <Sheet open={sheet && !!current} onClose={() => setSheet(false)} title={current?.displayName}>
            {current && <ServiceDetail service={current} />}
          </Sheet>
        </>
      ) : (
        <div className="grid gap-6 grid-cols-[minmax(240px,320px)_minmax(0,1fr)] items-start">
          {list}
          <div className="bg-surface rounded-card p-5 min-w-0">
            {current ? <ServiceDetail service={current} showTitle /> : <SkeletonRows rows={3} />}
          </div>
        </div>
      )}
    </Page>
  )
}

function ServiceDetail({ service, showTitle }: { service: ServiceInfo; showTitle?: boolean }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  // Starting / stopping a service and reading its journal are admin-only (the API answers 403)
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const isOn = isRunning(service)
  const installed = isInstalled(service)
  const since = service.since ? Math.max(0, (Date.now() - Date.parse(service.since)) / 1000) : null
  const { data: logs, isLoading: loadingLogs, refetch } = useQuery({
    queryKey: ['service-logs', service.name],
    queryFn:  () => servicesService.getLogs(service.name, 80),
    enabled: isAdmin,
    retry: false,
  })

  const mut = useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') => servicesService.toggle(service.name, action),
    onSuccess: (_, action) => {
      qc.invalidateQueries({ queryKey: ['services'] })
      setTimeout(() => refetch(), 800)
      toast.success(`${service.displayName} ${action === 'start' ? 'démarré' : action === 'stop' ? 'arrêté' : 'redémarré'}`)
    },
    onError: () => toast.error(`${service.displayName} n’a pas répondu à la commande.`),
  })

  async function run(action: 'start' | 'stop' | 'restart') {
    if (action !== 'start') {
      const ok = await confirm({
        title: `${action === 'stop' ? 'Arrêter' : 'Redémarrer'} ${service.displayName} ?`,
        message: 'Si tu accèdes à Nexus à travers ce service (tunnel, Wi-Fi…), la connexion sera coupée.',
        confirmLabel: action === 'stop' ? 'Arrêter' : 'Redémarrer',
        danger: action === 'stop',
      })
      if (!ok) return
    }
    mut.mutate(action)
  }

  return (
    <div className="flex flex-col gap-5">
      {showTitle && (
        <div>
          <h2 className="text-title text-label">{service.displayName}</h2>
          <p className="text-subhead text-label2 font-mono mt-0.5">{service.name}</p>
        </div>
      )}
      <Group>
        <ListRow title="État" status={STATE[service.status].dot} detail={STATE[service.status].label} />
        {installed && since != null && <ListRow title={isOn ? 'Actif depuis' : 'Depuis'} detail={formatUptime(since)} />}
        {service.memory != null && <ListRow title="Mémoire" detail={formatBytes(service.memory)} />}
        {installed && service.enabled != null && <ListRow title="Au démarrage du serveur" detail={service.enabled ? 'Lancé' : 'Non lancé'} />}
        {service.description && <ListRow title="Description" detail={service.description} />}
        {service.units?.length > 0 && <ListRow title={service.units.length > 1 ? 'Unités' : 'Unité'} detail={<span className="font-mono text-[12px]">{service.units.join(', ')}</span>} />}
        {service.url && (
          <ListRow title="Adresse" detail={<a className="text-accent-text hover:underline inline-flex items-center gap-1" href={service.url} target="_blank" rel="noopener noreferrer">Ouvrir <ExternalLink size={12} strokeWidth={1.75} /></a>} />
        )}
      </Group>
      {service.status === 'waiting' && (
        <p className="text-caption text-label2 px-1 -mt-2">Le service se lance tout seul dès qu’on l’utilise, puis s’arrête quand plus personne ne s’en sert.</p>
      )}
      {!installed ? (
        <p className="text-subhead text-label2 px-1">Aucune unité systemd « {service.units?.join(' », « ') || service.name} » n’existe sur le serveur.</p>
      ) : isAdmin && (
        <div className="flex flex-wrap gap-2 max-md:grid max-md:grid-cols-3">
          <Button variant={isOn ? 'secondary' : 'primary'} disabled={isOn || mut.isPending} onClick={() => run('start')} className="max-md:min-h-[44px]">Démarrer</Button>
          <Button disabled={!isOn || mut.isPending} onClick={() => run('stop')} className="max-md:min-h-[44px]">Arrêter</Button>
          <Button disabled={mut.isPending} onClick={() => run('restart')} className="max-md:min-h-[44px]">Redémarrer</Button>
        </div>
      )}
      {isAdmin && <section aria-label="Journal">
        <div className="flex items-center justify-between mb-1.5 px-1">
          <h3 className="text-subhead text-label2">Journal</h3>
          <Button variant="plain" size="small" onClick={() => refetch()}>Actualiser</Button>
        </div>
        <div className="selectable rounded-[10px] p-3 max-h-72 overflow-auto font-mono text-[11.5px] leading-relaxed" style={{ background: 'var(--term-bg)', color: 'var(--term-fg)', boxShadow: 'inset 0 0 0 .5px var(--separator)' }}>
          {loadingLogs ? <SkeletonRows rows={3} /> : !logs?.length ? (
            <span className="text-label2">Aucune entrée dans le journal.</span>
          ) : logs.map((line, i) => (
            <div key={i} className={cn('whitespace-pre-wrap break-all', /error|failed/i.test(line) && 'text-danger-text')}>{line}</div>
          ))}
        </div>
      </section>}
    </div>
  )
}
