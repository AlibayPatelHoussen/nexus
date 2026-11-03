import type { ServiceInfo, ServiceStatus } from '@/types'

/** How each real systemd state is shown (label + status dot). */
export const SERVICE_STATE: Record<ServiceStatus, { label: string; dot: 'ok' | 'warn' | 'error' | 'off' }> = {
  active:       { label: 'Actif',          dot: 'ok' },
  waiting:      { label: 'Actif · à la demande', dot: 'ok' },
  activating:   { label: 'Démarrage…',     dot: 'warn' },
  deactivating: { label: 'Arrêt…',         dot: 'warn' },
  failed:       { label: 'En échec',       dot: 'error' },
  inactive:     { label: 'Arrêté',         dot: 'off' },
  missing:      { label: 'Non installé',   dot: 'off' },
  unknown:      { label: 'État inconnu',   dot: 'off' },
}

/** Running, or ready to start by itself when used (Cockpit) */
export const isRunning = (s: ServiceInfo) => s.status === 'active' || s.status === 'waiting' || s.status === 'activating'
export const isInstalled = (s: ServiceInfo) => s.status !== 'missing'
export const isStopped = (s: ServiceInfo) => s.status === 'inactive' || s.status === 'failed'
