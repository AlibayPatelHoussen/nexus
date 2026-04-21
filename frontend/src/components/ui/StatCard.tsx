import { cn } from '@/utils'

interface StatCardProps {
  icon:       React.ReactNode
  label:      string
  value:      string
  sub?:       string
  percent:    number
  color:      string
  dimColor:   string
  badgeText?: string
  badgeOk?:   boolean
  delay?:     number
}

export default function StatCard({
  icon, label, value, sub, percent,
  color, dimColor, badgeText, badgeOk = true, delay = 0,
}: StatCardProps) {
  return (
    <div
      className="card-hover p-[18px] animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between mb-3.5">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: dimColor }}
        >
          <div style={{ color }}>{icon}</div>
        </div>
        {badgeText && (
          <span
            className="badge text-[10.5px]"
            style={{
              background: badgeOk ? 'var(--green-dim)' : 'var(--orange-dim)',
              color:      badgeOk ? 'var(--green)'     : 'var(--orange)',
            }}
          >
            {badgeText}
          </span>
        )}
      </div>

      <div className="text-[24px] font-bold tracking-tight leading-none mb-1" style={{ color }}>
        {value}
      </div>
      <div className="text-[12px]" style={{ color: 'var(--text3)' }}>{label}</div>
      {sub && (
        <div className="text-[11px] mt-0.5 font-mono" style={{ color: 'var(--text3)' }}>{sub}</div>
      )}

      <div
        className="h-[3px] rounded-full mt-3 overflow-hidden"
        style={{ background: 'var(--surface3)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${Math.min(percent, 100)}%`, background: color }}
        />
      </div>
    </div>
  )
}
