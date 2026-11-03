/** Activity indicator (the spoked iOS / macOS spinner). */
export default function Spinner({ size = 20, label = 'Chargement' }: { size?: number; label?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" role="progressbar" aria-label={label}
      style={{ animation: 'nx-spin 0.9s steps(8) infinite', color: 'var(--label-2)', flexShrink: 0 }}
    >
      {Array.from({ length: 8 }, (_, i) => (
        <rect
          key={i} x="11" y="2" width="2" height="6" rx="1" fill="currentColor"
          opacity={0.25 + (i / 8) * 0.75} transform={`rotate(${i * 45} 12 12)`}
        />
      ))}
    </svg>
  )
}
