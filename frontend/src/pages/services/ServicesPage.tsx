import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, ScrollText, ExternalLink, Play, Square, RotateCcw } from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import { servicesService } from '@/services/systemService'
import { systemService } from '@/services/systemService'
import { getColorVar, getDimVar } from '@/utils'
import type { ServiceInfo } from '@/types'
import toast from 'react-hot-toast'

function DynamicIcon({ name, color }: { name: string; color: string }) {
  const pascal = name.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('')
  const Icon   = (LucideIcons as any)[pascal]
  if (!Icon) return null
  return <Icon size={16} strokeWidth={1.8} color={color} />
}

function ServiceCard({ service }: { service: ServiceInfo }) {
  const qc = useQueryClient()
  const [showLogs, setShowLogs] = useState(false)
  const [logs,     setLogs]     = useState<string[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)

  const isOn     = service.status === 'active'
  const isFailed = service.status === 'failed'
  const color    = getColorVar(service.color)
  const dimColor = getDimVar(service.color)

  const toggleMut = useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') =>
      servicesService.toggle(service.name, action),
    onSuccess: (_, action) => {
      qc.invalidateQueries({ queryKey: ['services'] })
      toast.success(`${service.displayName} ${
        action === 'start' ? 'démarré' : action === 'stop' ? 'arrêté' : 'redémarré'
      }`)
    },
    onError: () => toast.error(`Erreur sur ${service.displayName}`),
  })

  async function fetchLogs() {
    setLoadingLogs(true)
    try {
      const l = await servicesService.getLogs(service.name, 80)
      setLogs(l)
      setShowLogs(true)
    } catch { toast.error('Impossible de charger les logs') }
    finally { setLoadingLogs(false) }
  }

  return (
    <div className="card overflow-hidden animate-fade-up">
      {/* Card header */}
      <div className="flex items-center gap-3 p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: dimColor }}>
          <DynamicIcon name={service.icon} color={color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
            {service.displayName}
          </div>
          <div className="text-[11px] font-mono" style={{ color: 'var(--text3)' }}>
            {service.description}
          </div>
        </div>

        {/* Status badge */}
        <div
          className="badge text-[10.5px] px-2 py-0.5"
          style={{
            background: isOn ? 'var(--green-dim)' : isFailed ? 'var(--red-dim)' : 'var(--surface3)',
            color:      isOn ? 'var(--green)'     : isFailed ? 'var(--red)'     : 'var(--text3)',
          }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full mr-1.5 inline-block"
            style={{
              background: isOn ? 'var(--green)' : isFailed ? 'var(--red)' : 'var(--text3)',
              animation:  isOn ? 'pulse-glow 2.5s ease-in-out infinite' : 'none',
            }}
          />
          {service.status}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 p-3" style={{ background: 'var(--surface2)' }}>
        <button
          className="btn-ghost text-[12px] flex-1 justify-center"
          disabled={isOn || toggleMut.isPending}
          style={{ opacity: isOn ? 0.4 : 1 }}
          onClick={() => toggleMut.mutate('start')}
        >
          <Play size={12} strokeWidth={2} /> Démarrer
        </button>
        <button
          className="btn-ghost text-[12px] flex-1 justify-center"
          disabled={!isOn || toggleMut.isPending}
          style={{ opacity: !isOn ? 0.4 : 1 }}
          onClick={() => toggleMut.mutate('stop')}
        >
          <Square size={12} strokeWidth={2} /> Arrêter
        </button>
        <button
          className="btn-ghost text-[12px] flex-1 justify-center"
          disabled={toggleMut.isPending}
          onClick={() => toggleMut.mutate('restart')}
        >
          <RotateCcw size={12} strokeWidth={2} /> Redémarrer
        </button>
        <button
          className="btn-ghost text-[12px] px-3"
          onClick={fetchLogs}
          disabled={loadingLogs}
        >
          <ScrollText size={12} strokeWidth={2} />
        </button>
        {service.url && (
          <a href={service.url} target="_blank" rel="noopener noreferrer"
            className="btn-ghost text-[12px] px-3">
            <ExternalLink size={12} strokeWidth={2} />
          </a>
        )}
      </div>

      {/* Logs */}
      {showLogs && (
        <div className="border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between px-4 py-2"
            style={{ background: 'var(--surface2)' }}>
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text3)' }}>
              LOGS — {service.displayName}
            </span>
            <button className="text-[11px]" style={{ color: 'var(--text3)' }}
              onClick={() => setShowLogs(false)}>✕</button>
          </div>
          <div className="p-3 overflow-y-auto max-h-60 terminal-font text-[11px]"
            style={{ background: '#09090e', lineHeight: '1.7', color: '#9191a8' }}>
            {logs.length === 0
              ? <span style={{ color: 'var(--text3)' }}>Aucun log disponible</span>
              : logs.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">
                  {line.includes('error') || line.includes('Error') || line.includes('failed')
                    ? <span style={{ color: 'var(--red)' }}>{line}</span>
                    : line.includes('active') || line.includes('started') || line.includes('success')
                    ? <span style={{ color: 'var(--green)' }}>{line}</span>
                    : line
                  }
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  )
}

export default function ServicesPage() {
  const qc = useQueryClient()

  const { data: services = [], isLoading } = useQuery({
    queryKey: ['services'],
    queryFn:  servicesService.getAll,
    refetchInterval: 10_000,
  })

  const active   = services.filter((s) => s.status === 'active').length
  const inactive = services.filter((s) => s.status !== 'active').length

  return (
    <div className="min-h-full" style={{ background: 'var(--bg)' }}>

      {/* Topbar */}
      <div className="sticky top-0 z-40 flex items-center justify-between px-7 pt-6 pb-1"
        style={{ background: 'var(--bg)' }}>
        <div>
          <h1 className="text-[26px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Services
          </h1>
          <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text3)' }}>
            <span style={{ color: 'var(--green)' }}>{active} actifs</span>
            {' · '}
            <span style={{ color: inactive > 0 ? 'var(--red)' : 'var(--text3)' }}>
              {inactive} inactifs
            </span>
          </p>
        </div>
        <button
          className="btn-ghost text-[12.5px]"
          onClick={() => qc.invalidateQueries({ queryKey: ['services'] })}
        >
          <RefreshCw size={13} strokeWidth={2} /> Actualiser
        </button>
      </div>

      <div className="px-7 py-5">
        {isLoading ? (
          <div className="flex justify-center items-center h-40">
            <div className="w-5 h-5 border-2 rounded-full animate-spin"
              style={{ borderColor: 'var(--border2)', borderTopColor: 'var(--blue)' }} />
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {services.map((svc, i) => (
              <div key={svc.name} style={{ animationDelay: `${i * 40}ms` }}>
                <ServiceCard service={svc} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
