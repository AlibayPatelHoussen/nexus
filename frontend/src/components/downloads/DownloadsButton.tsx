import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { downloadsService } from '@/services/downloadsService'

/** iPhone: Médias › Téléchargements (navigation bar button with the active count). */
export default function DownloadsButton() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const { data } = useQuery({ queryKey: ['downloads'], queryFn: downloadsService.list, enabled: isAdmin, refetchInterval: 30_000 })
  if (!isAdmin) return null
  const active = (data ?? []).filter((d) => d.status === 'running' || d.status === 'queued').length
  return (
    <Link to="/downloads" className="relative w-11 h-11 grid place-items-center rounded-full text-label active:opacity-50" aria-label={`Téléchargements${active ? `, ${active} en cours` : ''}`}>
      <Download size={22} strokeWidth={1.75} />
      {active > 0 && (
        <span className="absolute top-1.5 right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-accent-fill text-white text-[11px] font-semibold leading-[17px] text-center tabular">{active}</span>
      )}
    </Link>
  )
}
