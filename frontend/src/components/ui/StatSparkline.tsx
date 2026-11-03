import { useId } from 'react'

interface StatSparklineProps {
  /** Oldest first */
  values:     number[]
  /** Second series drawn as a grey line (e.g. upload under download) */
  secondary?: number[]
  /** Fixed scale (e.g. 100 for percentages); otherwise the max of the data */
  max?:       number
  /** How many points the full width represents (history length) */
  capacity?:  number
  height?:    number
  label:      string
  className?: string
}

/**
 * Activity Monitor style graph: filled area under a thin line, faint mid
 * grid line, newest value on the right. Scales to its container width.
 */
export default function StatSparkline({ values, secondary, max, capacity = 60, height = 44, label, className }: StatSparklineProps) {
  const id = useId()
  const W = 300
  const H = height
  const top = Math.max(max ?? 0, ...values, ...(secondary ?? []), 1e-9)
  const x = (i: number, n: number) => W - (n - 1 - i) * (W / (capacity - 1))
  const y = (v: number) => H - 1 - (Math.min(v, top) / top) * (H - 4)
  const line = (vs: number[]) => vs.map((v, i) => `${i ? 'L' : 'M'}${x(i, vs.length).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const pts = values.slice(-capacity)
  const sec = secondary?.slice(-capacity)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}
      className={className} style={{ width: '100%', height: H, display: 'block', overflow: 'visible' }}
    >
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--separator)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
      <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--separator)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
      {pts.length > 1 && (
        <>
          <defs>
            <clipPath id={`${id}-c`}><rect x="0" y="0" width={W} height={H} /></clipPath>
          </defs>
          <g clipPath={`url(#${id}-c)`}>
            <path d={`${line(pts)} L${W} ${H} L${x(0, pts.length)} ${H} Z`} fill="var(--accent-soft)" />
            {sec && sec.length > 1 && (
              <path d={line(sec)} fill="none" stroke="var(--label-3)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            )}
            <path d={line(pts)} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </g>
        </>
      )}
    </svg>
  )
}

/** Capacity bar (disk): track + filled part. */
export function CapacityBar({ percent, label, warnAt = 90 }: { percent: number; label: string; warnAt?: number }) {
  const p = Math.max(0, Math.min(100, percent))
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} className="h-[6px] rounded-full bg-fill overflow-hidden">
      <div className="h-full rounded-full transition-[width] duration-slow ease-out" style={{ width: `${p}%`, background: p >= warnAt ? 'var(--orange)' : 'var(--accent)' }} />
    </div>
  )
}
