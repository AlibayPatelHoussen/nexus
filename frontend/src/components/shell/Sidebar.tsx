import { Link, useLocation } from 'react-router-dom'
import { motion, LayoutGroup } from 'framer-motion'
import { LogOut, Search } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { spring } from '@/design/motion'
import { cn } from '@/utils'
import { NAV, SECTIONS, type NavItem } from './nav'
import { useSectionStore } from './sectionStore'

interface SidebarProps {
  onSearch: () => void
  onLogout: () => void
  /** Tablet: close the panel after choosing */
  onNavigate?: () => void
}

/**
 * macOS 26 / iPadOS 26 sidebar: a Liquid Glass panel floating inside the
 * window, above the content. Rows and headers from Apple's macOS 26 kit
 * (32 px rows, 13 pt medium labels, accent symbols in a 24 px column, bold
 * secondary section headers); the selection is a capsule that slides on a
 * spring to the chosen row.
 */
// Section of the last library page (title pages keep it selected, even after the
// full-screen reader / player)
let lastNav: string | undefined

export default function Sidebar({ onSearch, onLogout, onNavigate }: SidebarProps) {
  const user = useAuthStore((s) => s.user)
  const { pathname } = useLocation()
  const isAdmin = user?.role === 'admin'
  const visible = (i: NavItem) => isAdmin || !i.adminOnly
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
  // Title pages (/media/…) keep the library they were opened from selected, else their own
  const section = useSectionStore((s) => s.section)
  const found = NAV.find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))?.to
  if (found) lastNav = found
  const activeTo = found ?? lastNav ?? (section ? NAV.find((i) => i.to === section)?.to : undefined)

  const link = (item: NavItem) => {
    const on = activeTo === item.to
    return (
      <Link
        key={item.to}
        to={item.to}
        onClick={onNavigate}
        aria-current={on ? 'page' : undefined}
        className={cn(
          'no-press relative flex items-center gap-1 h-8 pl-1.5 pr-2 rounded-pill text-[13px] font-[510] leading-4',
          on ? 'text-[color:var(--glass-label)]' : 'text-[color:var(--glass-label)] hover:bg-[color:var(--glass-hover)]',
        )}
      >
        {on && (
          <motion.span
            layoutId="sidebar-selection"
            transition={spring.selection}
            className="absolute inset-0 rounded-pill bg-[color:var(--glass-select)]"
            aria-hidden="true"
          />
        )}
        <span className="relative w-6 flex justify-center flex-shrink-0">
          <item.icon size={16} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
        </span>
        <span className="relative truncate">{item.label}</span>
      </Link>
    )
  }

  return (
    <aside
      id="nexus-sidebar"
      aria-label="Navigation"
      className="h-full flex flex-col glass-strong rounded-sidebar overflow-hidden"
      style={{ width: 'var(--sidebar-w)' }}
    >
      <LayoutGroup id="sidebar">
        <div className="px-3.5 pb-2" style={{ paddingTop: 'max(14px, env(safe-area-inset-top, 0px))' }}>
          <button
            type="button"
            onClick={onSearch}
            className="w-full flex items-center gap-1.5 h-8 px-3 rounded-pill bg-[color:var(--glass-select)] text-[color:var(--glass-label-2)] text-[13px]"
            aria-label="Rechercher (⌘K)"
          >
            <Search size={14} strokeWidth={2} aria-hidden="true" />
            <span className="flex-1 text-left">Rechercher</span>
            <kbd className="font-sans text-caption opacity-80">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3.5 pb-3 scrollbar-none">
          {SECTIONS.map((s, i) => {
            const items = NAV.filter((n) => n.section === s.id && visible(n))
            if (!items.length) return null
            return (
              <div key={s.id}>
                <h2 className={cn('pl-1 pb-[9px] text-[13px] font-bold leading-4 text-[color:var(--glass-label-2)]', i === 0 ? 'pt-2' : 'pt-[18px]')}>
                  {s.label}
                </h2>
                <div className="flex flex-col">{items.map(link)}</div>
              </div>
            )
          })}
        </nav>

        <div className="px-3.5 pt-2 flex flex-col" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}>
          {NAV.filter((i) => i.section === 'settings').map(link)}
          <div className="flex items-center gap-2 h-11 pl-1.5 pr-1 mt-1">
            <span className="w-7 h-7 rounded-full bg-[color:var(--glass-select)] grid place-items-center text-caption font-semibold flex-shrink-0" aria-hidden="true">
              {user?.username?.[0]?.toUpperCase() ?? '?'}
            </span>
            <span className="flex-1 min-w-0 leading-tight">
              <span className="block text-[13px] font-[510] truncate">{user?.username}</span>
              <span className="block text-caption text-[color:var(--glass-label-2)]">{user?.role === 'admin' ? 'Administrateur' : 'Utilisateur'}</span>
            </span>
            <button
              type="button"
              onClick={onLogout}
              className="w-8 h-8 grid place-items-center rounded-full text-[color:var(--glass-label-2)] hover:bg-[color:var(--glass-select)]"
              aria-label="Déconnexion"
              title="Se déconnecter"
            >
              <LogOut size={15} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </LayoutGroup>
    </aside>
  )
}
