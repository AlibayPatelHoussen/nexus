import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Layers, LayoutDashboard, FolderOpen, Terminal,
  Film, Tv2, BookOpen, Activity, Zap, Wifi,
  Settings2, LogOut, Sun, Moon, Menu, X,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/utils'
import VersionBanner from './VersionBanner'

const COLLAPSE_KEY = 'nexus-sidebar-collapsed'

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
}

const NAV_SECTIONS = [
  {
    label: 'Principal',
    items: [
      { to: '/dashboard', icon: <LayoutDashboard size={13} strokeWidth={2} />, label: 'Dashboard', color: 'var(--blue-dim)', iconColor: 'var(--blue)' },
      { to: '/files',     icon: <FolderOpen     size={13} strokeWidth={2} />, label: 'Fichiers',   color: 'var(--orange-dim)', iconColor: 'var(--orange)', adminOnly: true },
      { to: '/terminal',  icon: <Terminal        size={13} strokeWidth={2} />, label: 'Terminal',   color: 'var(--purple-dim)', iconColor: 'var(--purple)', adminOnly: true },
    ],
  },
  {
    label: 'Médias',
    items: [
      { to: '/cinema',  icon: <Film     size={13} strokeWidth={2} />, label: 'Cinéma',  color: 'var(--red-dim)',    iconColor: 'var(--red)'    },
      { to: '/animes',  icon: <Tv2      size={13} strokeWidth={2} />, label: 'Animes',  color: 'var(--teal-dim)',   iconColor: 'var(--teal)'   },
      { to: '/manga',   icon: <BookOpen size={13} strokeWidth={2} />, label: 'Manga',   color: 'var(--purple-dim)', iconColor: 'var(--purple)' },
    ],
  },
  {
    label: 'Système',
    items: [
      { to: '/services', icon: <Activity  size={13} strokeWidth={2} />, label: 'Services',   color: 'var(--green-dim)',  iconColor: 'var(--green)'  },
      { to: '/scripts',  icon: <Zap       size={13} strokeWidth={2} />, label: 'Scripts',    color: 'var(--blue-dim)',   iconColor: 'var(--blue)',   adminOnly: true },
      { to: '/network',  icon: <Wifi      size={13} strokeWidth={2} />, label: 'Réseau',     color: 'var(--yellow-dim)', iconColor: 'var(--yellow)' },
      { to: '/settings', icon: <Settings2 size={13} strokeWidth={2} />, label: 'Paramètres', color: 'var(--surface3)',   iconColor: 'var(--text3)'  },
    ],
  },
]

export default function Layout() {
  const navigate  = useNavigate()
  const user      = useAuthStore((s) => s.user)
  const isAdmin   = user?.role === 'admin'
  const theme     = useAuthStore((s) => s.theme)
  const setTheme  = useAuthStore((s) => s.setTheme)
  const logout    = useAuthStore((s) => s.logout)
  const location  = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Desktop: sidebar can be collapsed to an icon rail (remembered per browser)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const rail = collapsed && isDesktop

  function toggleCollapsed() {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1') } catch { /* storage unavailable */ }
      return !c
    })
  }

  // Close the mobile drawer on navigation and with Escape
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const currentLabel = NAV_SECTIONS.flatMap((s) => s.items)
    .find((i) => location.pathname.startsWith(i.to))?.label ?? 'Nexus'

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  function toggleTheme() {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* ── Mobile backdrop ── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── SIDEBAR (static on desktop, drawer below lg) ── */}
      <aside
        id="nexus-sidebar"
        className={cn(
          'flex flex-col w-[260px] flex-shrink-0 border-r h-full overflow-hidden',
          rail ? 'lg:w-[68px]' : 'lg:w-[240px]',
          'fixed inset-y-0 left-0 z-50 transition-[transform,width] duration-200 ease-out lg:static lg:translate-x-0',
          drawerOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {/* Header */}
        <div className={cn('border-b', rail ? 'px-3 py-4' : 'p-5 pb-4')} style={{ borderColor: 'var(--border)' }}>
          <div className={cn('flex items-center gap-2.5', rail && 'flex-col')}>
            {/* Desktop hamburger: collapse / expand the sidebar */}
            <button
              className={cn('hidden lg:flex w-[34px] h-[34px] rounded-[9px] items-center justify-center flex-shrink-0 transition-colors hover:bg-[var(--surface2)]', !rail && 'order-last ml-auto -mr-1.5')}
              style={{ color: 'var(--text2)' }}
              onClick={toggleCollapsed}
              aria-label={rail ? 'Déplier le menu' : 'Replier le menu'}
              aria-expanded={!rail}
              aria-controls="nexus-sidebar"
              title={rail ? 'Déplier le menu' : 'Replier le menu'}
            >
              <Menu size={18} strokeWidth={2} />
            </button>
            <div
              className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--blue)', boxShadow: '0 0 16px var(--blue-dim)' }}
            >
              <Layers size={16} color="white" strokeWidth={2.5} />
            </div>
            <div className={cn('min-w-0', rail && 'hidden')}>
              <div className="text-[15px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                Nexus
              </div>
              <div className="text-[10.5px] font-mono truncate" style={{ color: 'var(--text3)' }}>
                {window.location.hostname}
              </div>
            </div>
            <button
              className="ml-auto p-2 -mr-2 rounded-lg lg:hidden"
              style={{ color: 'var(--text2)' }}
              onClick={() => setDrawerOpen(false)}
              aria-label="Fermer le menu"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Nav */}
        <nav className={cn('flex-1 overflow-y-auto overflow-x-hidden p-3 flex flex-col', rail ? 'gap-3' : 'gap-5')}>
          {NAV_SECTIONS.map((section, si) => (
            <div key={section.label}>
              {rail ? (
                si > 0 && <div className="h-px mx-2 mb-3" style={{ background: 'var(--border)' }} />
              ) : (
                <div
                  className="text-[10px] font-semibold uppercase tracking-widest px-2 mb-1"
                  style={{ color: 'var(--text3)' }}
                >
                  {section.label}
                </div>
              )}
              <div className="flex flex-col gap-px">
                {section.items.filter((item) => isAdmin || !('adminOnly' in item && item.adminOnly)).map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    title={rail ? item.label : undefined}
                    aria-label={rail ? item.label : undefined}
                    className={({ isActive }) =>
                      cn('nav-item text-[13.5px] font-medium', rail && 'justify-center !px-0', isActive && 'active')
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <div
                          className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center flex-shrink-0"
                          style={{ background: isActive ? 'var(--blue)' : item.color }}
                        >
                          <div style={{ color: isActive ? 'white' : item.iconColor }}>
                            {item.icon}
                          </div>
                        </div>
                        {!rail && <span className="truncate">{item.label}</span>}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t space-y-1" style={{ borderColor: 'var(--border)' }}>
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className={cn('nav-item w-full text-[13px] font-medium', rail && 'justify-center !px-0')}
            title={rail ? (theme === 'dark' ? 'Mode clair' : 'Mode sombre') : undefined}
            aria-label={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
          >
            <div
              className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center"
              style={{ background: 'var(--surface3)' }}
            >
              {theme === 'dark'
                ? <Sun  size={13} strokeWidth={2} style={{ color: 'var(--yellow)' }} />
                : <Moon size={13} strokeWidth={2} style={{ color: 'var(--blue)'   }} />
              }
            </div>
            {!rail && (
              <span style={{ color: 'var(--text2)' }}>
                {theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
              </span>
            )}
          </button>

          {/* User */}
          <div className={cn('flex items-center gap-2.5 py-2 rounded-lg', rail ? 'flex-col px-0' : 'px-2.5')}>
            <div
              className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, var(--blue), var(--purple))' }}
              title={rail ? `${user?.username ?? ''} (${user?.role ?? ''})` : undefined}
            >
              {user?.username?.[0]?.toUpperCase() || '?'}
            </div>
            <div className={cn('flex-1 min-w-0', rail && 'hidden')}>
              <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                {user?.username}
              </div>
              <div className="text-[10.5px]" style={{ color: 'var(--text3)' }}>
                {user?.role}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: 'var(--text3)' }}
              title="Déconnexion"
              aria-label="Déconnexion"
            >
              <LogOut size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="flex-1 min-w-0 flex flex-col h-full">
        {/* Mobile top bar */}
        <header
          className="lg:hidden flex items-center gap-3 px-4 h-14 border-b flex-shrink-0"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)', paddingTop: 'env(safe-area-inset-top)' }}
        >
          <button
            className="p-2 -ml-2 rounded-lg"
            style={{ color: 'var(--text)' }}
            onClick={() => setDrawerOpen(true)}
            aria-label="Ouvrir le menu"
            aria-controls="nexus-sidebar"
            aria-expanded={drawerOpen}
          >
            <Menu size={20} strokeWidth={2} />
          </button>
          <div
            className="w-[28px] h-[28px] rounded-[8px] flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--blue)' }}
          >
            <Layers size={14} color="white" strokeWidth={2.5} />
          </div>
          <span className="text-[15px] font-semibold truncate" style={{ color: 'var(--text)' }}>
            {currentLabel}
          </span>
          <button
            onClick={toggleTheme}
            className="ml-auto p-2 -mr-2 rounded-lg"
            style={{ color: 'var(--text2)' }}
            aria-label={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
          >
            {theme === 'dark' ? <Sun size={18} strokeWidth={2} /> : <Moon size={18} strokeWidth={2} />}
          </button>
        </header>

        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
          <VersionBanner />
          <Outlet />
        </main>
      </div>
    </div>
  )
}
