import { useQuery } from '@tanstack/react-query'
import {
  Cpu, MemoryStick, HardDrive, Thermometer,
  ArrowRight, RefreshCw, ArrowDownCircle, ScrollText, Terminal,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useSystemStats } from '@/hooks/useSocket'
import { servicesService } from '@/services/systemService'
import StatCard from '@/components/ui/StatCard'
import ServiceRow from '@/components/services/ServiceRow'
import { formatBytes, formatUptime } from '@/utils'
import toast from 'react-hot-toast'

export default function DashboardPage() {
  const user    = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  // Real-time stats via WebSocket
  const { stats, connected } = useSystemStats()

  // Services
  const { data: services } = useQuery({
    queryKey: ['services'],
    queryFn:  servicesService.getAll,
    refetchInterval: 10_000,
  })

  const now = new Date().toLocaleDateString('fr-CA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  async function handleRestart() {
    if (!confirm('Redémarrer le serveur ?')) return
    toast('Redémarrage en cours…')
  }

  async function handleUpdates() {
    toast('Vérification des mises à jour…')
  }

  return (
    <div className="min-h-full" style={{ background: 'var(--bg)' }}>

      {/* ── TOPBAR ── */}
      <div
        className="sticky top-0 z-40 flex items-start justify-between px-7 pt-6 pb-1"
        style={{ background: 'var(--bg)' }}
      >
        <div>
          <h1 className="text-[26px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Bonjour, {user?.username} 👋
          </h1>
          <p className="text-[12.5px] mt-0.5 capitalize" style={{ color: 'var(--text3)' }}>
            {now} ·{' '}
            <span style={{ color: connected ? 'var(--green)' : 'var(--red)' }}>
              {connected ? 'En ligne' : 'Hors ligne'}
            </span>
            {stats && ` · Uptime ${formatUptime(stats.uptime)}`}
          </p>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button className="btn-ghost text-[12.5px]" onClick={handleUpdates}>
            <ArrowDownCircle size={13} strokeWidth={2} />
            Mises à jour
          </button>
          <button className="btn-primary text-[12.5px]" onClick={() => navigate('/files')}>
            <ArrowRight size={13} strokeWidth={2} />
            Fichiers
          </button>
        </div>
      </div>

      <div className="px-7 py-5 flex flex-col gap-4">

        {/* ── STATS ROW ── */}
        <div className="grid grid-cols-4 gap-3 stagger">
          <StatCard
            icon={<Cpu size={15} strokeWidth={2} />}
            label="Utilisation CPU"
            value={stats ? `${Math.round(stats.cpu.usage)}%` : '—'}
            sub={stats?.cpu.model}
            percent={stats?.cpu.usage ?? 0}
            color="var(--blue)"
            dimColor="var(--blue-dim)"
            badgeText="Normal"
            badgeOk
            delay={40}
          />
          <StatCard
            icon={<MemoryStick size={15} strokeWidth={2} />}
            label={`RAM · ${stats ? formatBytes(stats.memory.total) : '—'}`}
            value={stats ? formatBytes(stats.memory.used) : '—'}
            percent={stats?.memory.usedPercent ?? 0}
            color="var(--purple)"
            dimColor="var(--purple-dim)"
            badgeText={stats ? `${stats.memory.usedPercent}%` : undefined}
            badgeOk={(stats?.memory.usedPercent ?? 0) < 85}
            delay={80}
          />
          <StatCard
            icon={<HardDrive size={15} strokeWidth={2} />}
            label={`Stockage · ${stats ? formatBytes(stats.disk.total) : '—'}`}
            value={stats ? formatBytes(stats.disk.used) : '—'}
            percent={stats?.disk.usedPercent ?? 0}
            color="var(--orange)"
            dimColor="var(--orange-dim)"
            badgeText={stats ? `${stats.disk.usedPercent}%` : undefined}
            badgeOk={(stats?.disk.usedPercent ?? 0) < 90}
            delay={120}
          />
          {(() => {
            const temp = stats?.temperature ?? null
            const tempColor    = temp == null ? 'var(--green)' : temp >= 80 ? 'var(--red)'    : temp >= 60 ? 'var(--orange)'    : 'var(--green)'
            const tempDimColor = temp == null ? 'var(--green-dim)' : temp >= 80 ? 'var(--red-dim)' : temp >= 60 ? 'var(--orange-dim)' : 'var(--green-dim)'
            const tempLabel    = temp == null ? '—'        : temp >= 80 ? 'Critique'  : temp >= 60 ? 'Chaud'     : 'Normal'
            return (
              <StatCard
                icon={<Thermometer size={15} strokeWidth={2} />}
                label="Température CPU"
                value={temp != null ? `${temp} °C` : '—'}
                percent={temp != null ? Math.min(temp, 100) : 0}
                color={tempColor}
                dimColor={tempDimColor}
                badgeText={tempLabel}
                badgeOk={temp == null || temp < 60}
                delay={160}
              />
            )
          })()}
        </div>

        {/* ── MAIN GRID ── */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 300px' }}>

          {/* LEFT */}
          <div className="flex flex-col gap-4">

            {/* STORAGE VISUAL */}
            {stats && (
              <div className="card p-5 animate-fade-up" style={{ animationDelay: '200ms' }}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
                    Stockage
                  </h2>
                  <span className="text-[12px]" style={{ color: 'var(--text3)' }}>
                    {formatBytes(stats.disk.free)} libres sur {formatBytes(stats.disk.total)}
                  </span>
                </div>

                {/* Bar — widths computed from real directory sizes vs disk total */}
                {(() => {
                  const total = stats.disk.total || 1
                  const ms    = stats.mediaStorage ?? { films: 0, series: 0, animes: 0, manga: 0 }
                  const pct   = (n: number) => `${Math.max(0.5, (n / total) * 100).toFixed(1)}%`
                  const segments = [
                    { color: 'var(--red)',    bytes: ms.films  },
                    { color: 'var(--teal)',   bytes: ms.animes },
                    { color: 'var(--purple)', bytes: ms.series },
                    { color: 'var(--yellow)', bytes: ms.manga  },
                  ].filter(s => s.bytes > 0)
                  return (
                    <div
                      className="flex gap-0.5 rounded overflow-hidden mb-3"
                      style={{ height: '8px', background: 'var(--surface3)' }}
                    >
                      {segments.map((s, i) => (
                        <div key={s.color} style={{
                          width: pct(s.bytes),
                          background: s.color,
                          borderRadius: i === 0 ? '4px 0 0 4px' : undefined,
                        }} />
                      ))}
                      <div style={{ flex: 1, background: 'var(--surface3)', borderRadius: segments.length ? '0 4px 4px 0' : '4px' }} />
                    </div>
                  )
                })()}

                <div className="flex flex-wrap gap-4">
                  {[
                    { label: 'Films',  color: 'var(--red)',      bytes: stats.mediaStorage?.films  ?? 0 },
                    { label: 'Animes', color: 'var(--teal)',     bytes: stats.mediaStorage?.animes ?? 0 },
                    { label: 'Séries', color: 'var(--purple)',   bytes: stats.mediaStorage?.series ?? 0 },
                    { label: 'Manga',  color: 'var(--yellow)',   bytes: stats.mediaStorage?.manga  ?? 0 },
                    { label: 'Libre',  color: 'var(--surface3)', bytes: stats.disk.free, border: true },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text2)' }}>
                      <div
                        className="w-2 h-2 rounded-sm flex-shrink-0"
                        style={{
                          background: item.color,
                          border:     'border' in item ? '1px solid var(--border2)' : 'none',
                        }}
                      />
                      {item.label} · {formatBytes(item.bytes)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* NETWORK */}
            {stats && (
              <div className="card p-5 animate-fade-up" style={{ animationDelay: '220ms' }}>
                <h2 className="text-[14px] font-semibold mb-4" style={{ color: 'var(--text)' }}>
                  Réseau
                </h2>
                <div
                  className="grid grid-cols-4 gap-px rounded-lg overflow-hidden"
                  style={{ background: 'var(--border)' }}
                >
                  {[
                    { label: 'Statut',    value: stats.network.status === 'online' ? 'En ligne' : 'Hors ligne', green: stats.network.status === 'online' },
                    { label: 'IP locale', value: stats.network.ip || '—' },
                    { label: 'Interface', value: stats.network.interface ? stats.network.interface.slice(0, 10) + '…' : '—' },
                    { label: 'OS',        value: `${stats.os.distro} ${stats.os.release}` },
                  ].map((cell) => (
                    <div
                      key={cell.label}
                      className="px-4 py-3"
                      style={{ background: 'var(--surface2)' }}
                    >
                      <div className="text-[10.5px] mb-1" style={{ color: 'var(--text3)' }}>{cell.label}</div>
                      <div
                        className="text-[13px] font-semibold font-mono"
                        style={{ color: cell.green ? 'var(--green)' : 'var(--text)' }}
                      >
                        {cell.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* RIGHT */}
          <div className="flex flex-col gap-4">

            {/* SERVICES */}
            <div className="card animate-fade-up" style={{ animationDelay: '200ms' }}>
              <div className="flex items-center justify-between px-5 pt-5 pb-0 mb-3">
                <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
                  Services
                </h2>
                <button
                  className="flex items-center gap-1 text-[12px] font-medium"
                  style={{ color: 'var(--blue)' }}
                  onClick={() => navigate('/services')}
                >
                  Gérer <ArrowRight size={11} strokeWidth={2.5} />
                </button>
              </div>
              <div className="px-2 pb-3 flex flex-col gap-0.5">
                {services?.map((svc) => (
                  <ServiceRow key={svc.name} service={svc} />
                )) ?? (
                  <div className="px-3 py-4 text-center text-[12px]" style={{ color: 'var(--text3)' }}>
                    Chargement…
                  </div>
                )}
              </div>
            </div>

            {/* QUICK ACTIONS */}
            <div className="card p-4 animate-fade-up" style={{ animationDelay: '220ms' }}>
              <h2 className="text-[14px] font-semibold mb-3 px-1" style={{ color: 'var(--text)' }}>
                Actions rapides
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { icon: <RefreshCw size={13} strokeWidth={2} />,      label: 'Redémarrer',  color: 'var(--red)',    dim: 'var(--red-dim)',    action: handleRestart },
                  { icon: <ArrowDownCircle size={13} strokeWidth={2} />, label: 'Mises à jour', color: 'var(--blue)',  dim: 'var(--blue-dim)',   action: handleUpdates },
                  { icon: <ScrollText size={13} strokeWidth={2} />,      label: 'Logs',         color: 'var(--green)', dim: 'var(--green-dim)',  action: () => navigate('/services') },
                  { icon: <Terminal size={13} strokeWidth={2} />,         label: 'Terminal',     color: 'var(--purple)',dim: 'var(--purple-dim)', action: () => navigate('/terminal') },
                ].map((btn) => (
                  <button
                    key={btn.label}
                    className="flex items-center gap-2 p-3 rounded-lg border text-left transition-all duration-150"
                    style={{ background: 'var(--surface2)', borderColor: 'var(--border)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border2)'
                      e.currentTarget.style.background   = 'var(--surface3)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border)'
                      e.currentTarget.style.background   = 'var(--surface2)'
                    }}
                    onClick={btn.action}
                  >
                    <div
                      className="w-[28px] h-[28px] rounded-[7px] flex items-center justify-center flex-shrink-0"
                      style={{ background: btn.dim }}
                    >
                      <div style={{ color: btn.color }}>{btn.icon}</div>
                    </div>
                    <span className="text-[11.5px] font-semibold" style={{ color: 'var(--text)' }}>
                      {btn.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
