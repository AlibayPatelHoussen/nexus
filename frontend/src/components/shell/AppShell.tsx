import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useDevice } from '@/hooks/useDevice'
import { cn } from '@/utils'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import CommandPalette from './CommandPalette'
import VersionBanner from './VersionBanner'
import DownloadToasts from './DownloadToasts'
import { ShellContext, type ShellState } from './shellContext'
import { useRouteMotion } from './useRouteMotion'

const HIDDEN_KEY = 'nexus-sidebar-hidden'
const readHidden = () => { try { return localStorage.getItem(HIDDEN_KEY) === '1' } catch { return false } }

/**
 * Application frame, native on each device:
 * - desktop: translucent sidebar + content (sidebar can be hidden)
 * - tablet: content full width, sidebar slides over it (iPadOS)
 * - phone: content + tab bar; the document scrolls (status-bar tap, rubber band)
 */
export default function AppShell() {
  const device = useDevice()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const logout = useAuthStore((s) => s.logout)
  const [desktopHidden, setDesktopHidden] = useState(readHidden)
  const [panelOpen, setPanelOpen] = useState(false)   // tablet
  const [search, setSearch] = useState(false)

  const sidebarOpen = device === 'desktop' ? !desktopHidden : panelOpen
  const phoneRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const frame = useCallback(() => (device === 'phone' ? phoneRef.current : mainRef.current), [device])
  const scroller = useCallback(() => (device === 'phone' ? window : mainRef.current), [device])
  useRouteMotion(frame, device, scroller)
  const toggleSidebar = useCallback(() => {
    if (device === 'desktop') {
      setDesktopHidden((h) => {
        try { localStorage.setItem(HIDDEN_KEY, h ? '0' : '1') } catch { /* storage unavailable */ }
        return !h
      })
    } else setPanelOpen((o) => !o)
  }, [device])

  const handleLogout = useCallback(() => { logout(); navigate('/login', { replace: true }) }, [logout, navigate])

  // Close the tablet panel on navigation; keyboard shortcuts
  useEffect(() => { setPanelOpen(false) }, [pathname])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch((s) => !s) }
      else if (mod && e.key === ',') { e.preventDefault(); navigate('/settings') }
      else if (e.key === 'Escape' && panelOpen) setPanelOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, panelOpen])

  const shell = useMemo<ShellState>(() => ({
    device, sidebarOpen, toggleSidebar, openSearch: () => setSearch(true),
  }), [device, sidebarOpen, toggleSidebar])

  const isAdmin = useAuthStore((st) => st.user?.role === 'admin')
  // Admins: a live toast at the end of each download (the /downloads socket is admin only)
  const palette = <>{isAdmin && <DownloadToasts />}<CommandPalette open={search} onClose={() => setSearch(false)} onLogout={handleLogout} /></>

  if (device === 'phone') {
    return (
      <ShellContext.Provider value={shell}>
        {/* clip: a sliding page must not make the document scroll sideways */}
        <div ref={phoneRef} className="min-h-[100dvh] bg-bg overflow-x-clip" style={{ paddingBottom: 'calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px))' }}>
          <VersionBanner />
          <Outlet />
        </div>
        <TabBar />
        {palette}
      </ShellContext.Provider>
    )
  }

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-[100dvh] overflow-hidden bg-bg">
        {device === 'desktop' && sidebarOpen && (
          <div className="flex-shrink-0 h-full"><Sidebar onSearch={() => setSearch(true)} onLogout={handleLogout} /></div>
        )}
        {device === 'tablet' && (
          <>
            <div
              className={cn('fixed inset-0 z-40 transition-opacity duration ease-out', panelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none')}
              style={{ background: 'var(--overlay)' }}
              onClick={() => setPanelOpen(false)}
              aria-hidden="true"
            />
            <div
              className="fixed inset-y-0 left-0 z-50 transition-transform duration-slow ease-sheet"
              style={{ transform: panelOpen ? 'none' : 'translateX(-100%)', boxShadow: panelOpen ? 'var(--shadow-sheet)' : 'none' }}
              {...(panelOpen ? {} : { inert: '' })}
            >
              <Sidebar onSearch={() => setSearch(true)} onLogout={handleLogout} onNavigate={() => setPanelOpen(false)} />
            </div>
          </>
        )}
        <main ref={mainRef} className="flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden" id="main">
          <VersionBanner />
          <Outlet />
        </main>
      </div>
      {palette}
    </ShellContext.Provider>
  )
}
