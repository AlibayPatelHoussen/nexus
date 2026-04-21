import { ExternalLink } from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import type { ServiceInfo } from '@/types'
import { getColorVar, getDimVar } from '@/utils'
import { servicesService } from '@/services/systemService'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

interface ServiceRowProps {
  service: ServiceInfo
}

type LucideIconName = keyof typeof LucideIcons

function DynamicIcon({ name, ...props }: { name: string } & React.SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }) {
  const pascal = name
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')

  const Icon = (LucideIcons as Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>>)[pascal]
  if (!Icon) return null
  return <Icon size={15} strokeWidth={1.8} color={getColorVar(name)} />
}

export default function ServiceRow({ service }: ServiceRowProps) {
  const qc = useQueryClient()

  async function toggle() {
    const action = service.status === 'active' ? 'stop' : 'start'
    try {
      await servicesService.toggle(service.name, action)
      await qc.invalidateQueries({ queryKey: ['services'] })
      toast.success(`${service.displayName} ${action === 'start' ? 'démarré' : 'arrêté'}`)
    } catch {
      toast.error(`Erreur: impossible de ${action} ${service.displayName}`)
    }
  }

  const isOn = service.status === 'active'
  const color    = getColorVar(service.color)
  const dimColor = getDimVar(service.color)

  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer border border-transparent transition-all duration-150"
      style={{ borderColor: 'transparent' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Icon */}
      <div
        className="w-8 h-8 rounded-[8px] flex items-center justify-center flex-shrink-0"
        style={{ background: dimColor }}
      >
        <DynamicIcon name={service.icon} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
          {service.displayName}
        </div>
        <div className="text-[10.5px] font-mono" style={{ color: 'var(--text3)' }}>
          {service.description}
        </div>
      </div>

      {/* Status dot */}
      <div className="flex items-center gap-1.5 mr-1">
        <div
          className="w-[6px] h-[6px] rounded-full"
          style={{
            background: isOn ? 'var(--green)' : service.status === 'failed' ? 'var(--red)' : 'var(--text3)',
            boxShadow:  isOn ? '0 0 6px var(--green)' : 'none',
            animation:  isOn ? 'pulse-glow 2.5s ease-in-out infinite' : 'none',
          }}
        />
      </div>

      {/* External link */}
      {service.url && (
        <a
          href={service.url}
          target="_blank"
          rel="noopener noreferrer"
          className="w-[26px] h-[26px] rounded-[6px] flex items-center justify-center flex-shrink-0 transition-all duration-150"
          style={{ background: 'var(--surface3)', border: '1px solid var(--border2)' }}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--blue-dim)'
            e.currentTarget.style.borderColor = 'var(--blue)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--surface3)'
            e.currentTarget.style.borderColor = 'var(--border2)'
          }}
        >
          <ExternalLink size={11} strokeWidth={2.5} style={{ color: 'var(--text3)' }} />
        </a>
      )}

      {/* Toggle */}
      <div
        className={`toggle ${isOn ? '' : 'off'} flex-shrink-0`}
        onClick={toggle}
        title={isOn ? 'Arrêter' : 'Démarrer'}
      >
        <div className="toggle-thumb" />
      </div>
    </div>
  )
}
