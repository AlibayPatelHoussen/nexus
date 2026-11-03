import { NavLink } from 'react-router-dom'
import { LogOut, Search } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/utils'
import { NAV, SECTIONS, type NavItem } from './nav'

interface SidebarProps {
  onSearch: () => void
  onLogout: () => void
  /** Tablet: close the panel after choosing */
  onNavigate?: () => void
}

/** Translucent source list, like Finder / System Settings. */
export default function Sidebar({ onSearch, onLogout, onNavigate }: SidebarProps) {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'
  const visible = (i: NavItem) => isAdmin || !i.adminOnly
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

  const link = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) => cn(
        'flex items-center gap-2 h-[28px] px-2 rounded-[6px] text-body text-label',
        isActive ? 'bg-fill font-medium' : 'hoverable',
      )}
    >
      <item.icon size={16} strokeWidth={1.5} className="text-accent flex-shrink-0" aria-hidden="true" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  )

  return (
    <aside id="nexus-sidebar" aria-label="Navigation" className="h-full flex flex-col material-sidebar hairline-r" style={{ width: 'var(--sidebar-w)' }}>
      <div className="px-3 pt-4 pb-2" style={{ paddingTop: 'max(16px, env(safe-area-inset-top, 0px))' }}>
        <button
          type="button"
          onClick={onSearch}
          className="w-full flex items-center gap-1.5 h-[28px] px-2 rounded-[7px] bg-fill2 text-label2 text-body hoverable"
          aria-label="Rechercher (⌘K)"
        >
          <Search size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="flex-1 text-left">Rechercher</span>
          <kbd className="font-sans text-caption">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {SECTIONS.map((s) => {
          const items = NAV.filter((i) => i.section === s.id && visible(i))
          if (!items.length) return null
          return (
            <div key={s.id} className="mt-3 first:mt-1">
              <h2 className="px-2 pb-1 text-caption font-semibold text-label2">{s.label}</h2>
              <div className="flex flex-col gap-px">{items.map(link)}</div>
            </div>
          )
        })}
      </nav>

      <div className="px-3 pb-3 pt-2 flex flex-col gap-px" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}>
        {NAV.filter((i) => i.section === 'settings').map(link)}
        <div className="flex items-center gap-2 h-[40px] px-2 mt-1">
          <span className="w-6 h-6 rounded-full bg-fill grid place-items-center text-caption font-semibold text-label2 flex-shrink-0" aria-hidden="true">
            {user?.username?.[0]?.toUpperCase() ?? '?'}
          </span>
          <span className="flex-1 min-w-0 leading-tight">
            <span className="block text-body text-label truncate">{user?.username}</span>
            <span className="block text-caption text-label2">{user?.role === 'admin' ? 'Administrateur' : 'Utilisateur'}</span>
          </span>
          <button
            type="button"
            onClick={onLogout}
            className="w-7 h-7 grid place-items-center rounded-[6px] text-label2 hoverable"
            aria-label="Déconnexion"
            title="Se déconnecter"
          >
            <LogOut size={15} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </aside>
  )
}
