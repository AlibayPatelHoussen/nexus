import { useQuery } from '@tanstack/react-query'
import { Wifi, Server, RefreshCw } from 'lucide-react'
import { systemService } from '@/services/systemService'
import { formatBytes, formatUptime } from '@/utils'

export default function NetworkPage() {
  const { data: stats, isLoading, refetch } = useQuery({
    queryKey:       ['system-stats-once'],
    queryFn:        systemService.getStats,
    refetchInterval: 10_000,
  })

  const cells = stats ? [
    { label: 'Statut',     value: stats.network.status === 'online' ? 'En ligne' : 'Hors ligne', green: stats.network.status === 'online' },
    { label: 'IP locale',  value: stats.network.ip        || '—' },
    { label: 'Interface',  value: stats.network.interface || '—' },
    { label: 'Uptime',     value: formatUptime(stats.uptime) },
    { label: 'OS',         value: stats.os.distro },
    { label: 'Release',    value: stats.os.release },
    { label: 'Hostname',   value: stats.os.hostname },
    { label: 'Arch',       value: stats.os.arch },
    { label: 'RX total',   value: formatBytes(stats.network.rx) },
    { label: 'TX total',   value: formatBytes(stats.network.tx) },
  ] : []

  return (
    <div className="min-h-full" style={{ background: 'var(--bg)' }}>
      <div className="md:sticky top-0 z-30 flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-7 pt-5 sm:pt-6 pb-1"
        style={{ background: 'var(--bg)' }}>
        <div className="min-w-0">
          <h1 className="text-[22px] sm:text-[26px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>Réseau</h1>
          <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text3)' }}>
            Informations système et réseau
          </p>
        </div>
        <button className="btn-ghost text-[12.5px] flex-shrink-0" onClick={() => refetch()} aria-label="Actualiser">
          <RefreshCw size={13} strokeWidth={2} /> <span className="hidden sm:inline">Actualiser</span>
        </button>
      </div>

      <div className="px-4 sm:px-6 lg:px-7 py-5 grid gap-4 grid-cols-1 lg:grid-cols-2">

        {/* Network info */}
        <div className="card p-4 sm:p-5 animate-fade-up min-w-0">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--blue-dim)' }}>
              <Wifi size={15} strokeWidth={2} style={{ color: 'var(--blue)' }} />
            </div>
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Réseau</h2>
          </div>
          {isLoading ? (
            <div className="text-[12px]" style={{ color: 'var(--text3)' }}>Chargement…</div>
          ) : (
            <div className="grid grid-cols-2 gap-px rounded-lg overflow-hidden" style={{ background: 'var(--border)' }}>
              {cells.slice(0, 6).map((cell) => (
                <div key={cell.label} className="px-3 sm:px-4 py-3 min-w-0" style={{ background: 'var(--surface2)' }}>
                  <div className="text-[10.5px] mb-1" style={{ color: 'var(--text3)' }}>{cell.label}</div>
                  <div className="text-[12px] sm:text-[13px] font-semibold font-mono break-all"
                    style={{ color: cell.green ? 'var(--green)' : 'var(--text)' }}>
                    {cell.value}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* System info */}
        <div className="card p-4 sm:p-5 animate-fade-up min-w-0" style={{ animationDelay: '60ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--green-dim)' }}>
              <Server size={15} strokeWidth={2} style={{ color: 'var(--green)' }} />
            </div>
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Système</h2>
          </div>
          {!isLoading && (
            <div className="grid grid-cols-2 gap-px rounded-lg overflow-hidden" style={{ background: 'var(--border)' }}>
              {cells.slice(6).map((cell) => (
                <div key={cell.label} className="px-3 sm:px-4 py-3 min-w-0" style={{ background: 'var(--surface2)' }}>
                  <div className="text-[10.5px] mb-1" style={{ color: 'var(--text3)' }}>{cell.label}</div>
                  <div className="text-[12px] sm:text-[13px] font-semibold font-mono break-all" style={{ color: 'var(--text)' }}>
                    {cell.value}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
