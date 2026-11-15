import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useDevice } from '@/hooks/useDevice'
import { cn } from '@/utils'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import TabKeepAlive from './TabKeepAlive'
import CommandPalette from './CommandPalette'
import VersionBanner from './VersionBanner'
import DownloadToasts from './DownloadToasts'
import { ShellContext, type ShellState } from './shellContext'
import { useRouteMotion } from './useRouteMotion'
import { useAccess } from './access'
import { authService } from '@/services/authService'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'
import { RadioTower } from 'lucide-react'

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
  const updateUser = useAuthStore((s) => s.updateUser)
  const access = useAccess()

  // The account's role and access as the server knows them now (an admin may have changed them)
  useEffect(() => {
    authService.me().then((me) => updateUser({ role: me.role, username: me.username, canMedia: me.canMedia, canIptv: me.canIptv }))
      .catch(() => { /* signed out: the API client handles it */ })
  }, [updateUser])

  // « IPTV seulement » accounts use the IPTV's own address: sent there (to sign in again)
  const iptvOnly = !access.admin && !access.media && !access.iptvHost
  useEffect(() => {
    if (!iptvOnly || !access.iptvUrl) return
    logout()
    window.location.replace(`${access.iptvUrl}/login?from=nexus`)
  }, [iptvOnly, access.iptvUrl, logout])

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

  // The IPTV's address, opened by an account without the IPTV: nothing to show here
  if (access.iptvHost && !access.iptv) return <NoIptvAccess onLogout={handleLogout} />

  // A live toast at the end of each download (accounts with the media). Each account hears about its own downloads only
  const palette = <>{access.media && <DownloadToasts />}<CommandPalette open={search} onClose={() => setSearch(false)} onLogout={handleLogout} /></>

  if (device === 'phone') {
    return (
      <ShellContext.Provider value={shell}>
        {/* clip: a sliding page must not make the document scroll sideways */}
        {/* Content clears the floating tab bar (bar + its gap + 16) */}
        <div ref={phoneRef} className="min-h-[100dvh] bg-bg overflow-x-clip" style={{ paddingBottom: 'calc(var(--tabbar-h) + var(--tabbar-bottom) + 16px)' }}>
          <VersionBanner />
          <TabKeepAlive />
        </div>
        <TabBar />
        {palette}
      </ShellContext.Provider>
    )
  }

  return (
    <ShellContext.Provider value={shell}>
      {/* The content takes the whole window; the glass sidebar floats above it, 8 px inside
          the window (macOS 26). Pages leave --content-left free; heroes may bleed under the glass. */}
      <div className="relative h-[100dvh] overflow-hidden bg-bg"
        style={{ '--content-left': device === 'desktop' && sidebarOpen ? 'calc(var(--sidebar-w) + var(--sidebar-inset))' : '0px' } as React.CSSProperties}>
        {device === 'desktop' && sidebarOpen && (
          <div className="absolute z-30" style={{ top: 'var(--sidebar-inset)', bottom: 'var(--sidebar-inset)', left: 'var(--sidebar-inset)' }}>
            <Sidebar onSearch={() => setSearch(true)} onLogout={handleLogout} />
          </div>
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
              className="fixed z-50 transition-transform duration-slow ease-sheet"
              style={{ top: 'var(--sidebar-inset)', bottom: 'var(--sidebar-inset)', left: 'var(--sidebar-inset)', transform: panelOpen ? 'none' : 'translateX(calc(-100% - 16px))' }}
              {...(panelOpen ? {} : { inert: '' })}
            >
              <Sidebar onSearch={() => setSearch(true)} onLogout={handleLogout} onNavigate={() => setPanelOpen(false)} />
            </div>
          </>
        )}
        <main ref={mainRef} className="h-full overflow-y-auto overflow-x-hidden" id="main" style={{ paddingLeft: 'var(--content-left)' }}>
          <VersionBanner />
          <Outlet />
        </main>
      </div>
      {palette}
    </ShellContext.Provider>
  )
}

/** The IPTV's address, opened by an account that has no IPTV. */
function NoIptvAccess({ onLogout }: { onLogout: () => void }) {
  return (
    <main className="min-h-[100dvh] grid place-items-center bg-bg px-4">
      <EmptyState
        icon={<RadioTower strokeWidth={1.25} />}
        title="Pas d’accès à l’IPTV"
        message="Ce compte n’a pas accès à l’IPTV. Ouvre Nexus à son adresse habituelle, ou demande l’accès à l’administrateur."
        action={<Button onClick={onLogout}>Se déconnecter</Button>}
      />
    </main>
  )
}
