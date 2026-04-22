import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Layers, LayoutDashboard, FolderOpen, Terminal,
  Film, Tv2, BookOpen, Activity, Zap, Wifi,
  Settings2, LogOut, Sun, Moon,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/utils'

const NAV_SECTIONS = [
  {
    label: 'Principal',
    items: [
      { to: '/dashboard', icon: <LayoutDashboard size={13} strokeWidth={2} />, label: 'Dashboard', color: 'var(--blue-dim)', iconColor: 'var(--blue)' },
      { to: '/files',     icon: <FolderOpen     size={13} strokeWidth={2} />, label: 'Fichiers',   color: 'var(--orange-dim)', iconColor: 'var(--orange)' },
      { to: '/terminal',  icon: <Terminal        size={13} strokeWidth={2} />, label: 'Terminal',   color: 'var(--purple-dim)', iconColor: 'var(--purple)' },
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
      { to: '/scripts',  icon: <Zap       size={13} strokeWidth={2} />, label: 'Scripts',    color: 'var(--blue-dim)',   iconColor: 'var(--blue)'   },
      { to: '/network',  icon: <Wifi      size={13} strokeWidth={2} />, label: 'Réseau',     color: 'var(--yellow-dim)', iconColor: 'var(--yellow)' },
      { to: '/settings', icon: <Settings2 size={13} strokeWidth={2} />, label: 'Paramètres', color: 'var(--surface3)',   iconColor: 'var(--text3)'  },
    ],
  },
]

export default function Layout() {
  const navigate  = useNavigate()
  const user      = useAuthStore((s) => s.user)
  const theme     = useAuthStore((s) => s.theme)
  const setTheme  = useAuthStore((s) => s.setTheme)
  const logout    = useAuthStore((s) => s.logout)

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  function toggleTheme() {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* ── SIDEBAR ── */}
      <aside
        className="flex flex-col w-[240px] flex-shrink-0 border-r h-full overflow-hidden"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {/* Header */}
        <div className="p-5 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <div
              className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--blue)', boxShadow: '0 0 16px var(--blue-dim)' }}
            >
              <Layers size={16} color="white" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-[15px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                Nexus
              </div>
              <div className="text-[10.5px] font-mono" style={{ color: 'var(--text3)' }}>
                houssen-serveur.com
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 flex flex-col gap-5">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div
                className="text-[10px] font-semibold uppercase tracking-widest px-2 mb-1"
                style={{ color: 'var(--text3)' }}
              >
                {section.label}
              </div>
              <div className="flex flex-col gap-px">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      cn('nav-item text-[13.5px] font-medium', isActive && 'active')
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
                        <span>{item.label}</span>
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
            className="nav-item w-full text-[13px] font-medium"
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
            <span style={{ color: 'var(--text2)' }}>
              {theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
            </span>
          </button>

          {/* User */}
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg">
            <div
              className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, var(--blue), var(--purple))' }}
            >
              {user?.username?.[0]?.toUpperCase() || 'H'}
            </div>
            <div className="flex-1 min-w-0">
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
            >
              <LogOut size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
