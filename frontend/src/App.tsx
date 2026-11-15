import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, lazy, Suspense } from 'react'
import { applyAppearance, useAuthStore } from '@/stores/authStore'
import AppShell      from '@/components/shell/AppShell'
import { homePath, useAccess } from '@/components/shell/access'
import LoginPage     from '@/pages/login/LoginPage'
import DashboardPage from '@/pages/dashboard/DashboardPage'
import NotFoundPage  from '@/pages/NotFoundPage'
import Spinner       from '@/components/ui/Spinner'

const FilesPage = lazy(() => import('@/pages/files/FilesPage'))
const JarvisPage = lazy(() => import('@/pages/jarvis/JarvisPage'))
const TerminalPage = lazy(() => import('@/pages/terminal/TerminalPage'))
const CinemaPage = lazy(() => import('@/pages/cinema/CinemaPage'))
const AnimesPage = lazy(() => import('@/pages/animes/AnimesPage'))
const MangaPage = lazy(() => import('@/pages/manga/MangaPage'))
const ServicesPage = lazy(() => import('@/pages/services/ServicesPage'))
const NetworkPage = lazy(() => import('@/pages/network/NetworkPage'))
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'))
const DownloadsPage = lazy(() => import('@/pages/downloads/DownloadsPage'))
const YoutubePage = lazy(() => import('@/pages/youtube/YoutubePage'))
const MyListPage = lazy(() => import('@/pages/mylist/MyListPage'))
const PlayerPage = lazy(() => import('@/pages/player/PlayerPage'))
const MangaReader = lazy(() => import('@/pages/player/MangaReaderPage'))
const MediaDetail = lazy(() => import('@/pages/media/MediaDetailPage'))
const IptvPage = lazy(() => import('@/pages/iptv/IptvPage'))
const IptvPlayer = lazy(() => import('@/pages/iptv/IptvPlayerPage'))

const PAGE_CHUNKS: (() => Promise<unknown>)[] = [
  () => import('@/pages/files/FilesPage'),
  () => import('@/pages/terminal/TerminalPage'),
  () => import('@/pages/cinema/CinemaPage'),
  () => import('@/pages/animes/AnimesPage'),
  () => import('@/pages/manga/MangaPage'),
  () => import('@/pages/services/ServicesPage'),
  () => import('@/pages/network/NetworkPage'),
  () => import('@/pages/settings/SettingsPage'),
  () => import('@/pages/downloads/DownloadsPage'),
  () => import('@/pages/youtube/YoutubePage'),
  () => import('@/pages/mylist/MyListPage'),
  () => import('@/pages/player/PlayerPage'),
  () => import('@/pages/player/MangaReaderPage'),
  () => import('@/pages/media/MediaDetailPage'),
  () => import('@/pages/iptv/IptvPage'),
]

function PageLoader() {
  return <div className="flex items-center justify-center h-full min-h-[300px]"><Spinner /></div>
}

function Guard({ children }: { children: React.ReactNode }) {
  const isAuth = useAuthStore((s) => s.isAuth)
  return isAuth ? <>{children}</> : <Navigate to="/login" replace />
}

/** Server pages: admins only (and never on the IPTV's subdomain). */
function AdminOnly({ children }: { children: React.ReactNode }) {
  const a = useAccess()
  return a.admin && !a.iptvHost ? <>{children}</> : <Navigate to={homePath(a)} replace />
}

/** Pages of the media / of the IPTV: accounts (and addresses) that have them; else home. */
function Need({ media, iptv, children }: { media?: boolean; iptv?: boolean; children: React.ReactNode }) {
  const a = useAccess()
  if ((media && !a.media) || (iptv && !a.iptv)) return <Navigate to={homePath(a)} replace />
  return <>{children}</>
}

/** « / »: Aperçu with the media, else the IPTV. */
function Home() {
  return <Navigate to={homePath(useAccess())} replace />
}

function S({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

export default function App() {
  const appearance = useAuthStore((s) => s.appearance)

  useEffect(() => { applyAppearance(appearance) }, [appearance])
  // Section pages loaded in the background once the app is idle: switching tab never
  // waits for their code (a spinner flashed on the first visit of each tab)
  useEffect(() => {
    const load = () => { for (const f of PAGE_CHUNKS) void f().catch(() => {}) }
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
    const t = setTimeout(() => (ric ? ric(load) : load()), 1200)
    return () => clearTimeout(t)
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* App frame: sidebar / tab bar */}
        <Route path="/" element={<Guard><AppShell /></Guard>}>
          <Route index element={<Home />} />
          <Route path="dashboard" element={<Need media><DashboardPage /></Need>} />
          <Route path="jarvis"    element={<AdminOnly><S><JarvisPage   /></S></AdminOnly>} />
          <Route path="files"     element={<AdminOnly><S><FilesPage    /></S></AdminOnly>} />
          <Route path="terminal"  element={<AdminOnly><S><TerminalPage /></S></AdminOnly>} />
          <Route path="cinema"    element={<Need media><S><CinemaPage   /></S></Need>} />
          <Route path="animes"    element={<Need media><S><AnimesPage   /></S></Need>} />
          <Route path="manga"     element={<Need media><S><MangaPage    /></S></Need>} />
          <Route path="services"  element={<AdminOnly><S><ServicesPage /></S></AdminOnly>} />
          <Route path="network"   element={<AdminOnly><S><NetworkPage  /></S></AdminOnly>} />
          <Route path="settings"  element={<S><SettingsPage /></S>} />
          <Route path="downloads" element={<Need media><S><DownloadsPage /></S></Need>} />
          <Route path="youtube"   element={<Need media><S><YoutubePage /></S></Need>} />
          <Route path="ma-liste"  element={<Need media><S><MyListPage /></S></Need>} />
          <Route path="media/:id" element={<Need media><S><MediaDetail  /></S></Need>} />
          <Route path="iptv"       element={<Need iptv><S><IptvPage /></S></Need>} />
          <Route path="iptv/:view" element={<Need iptv><S><IptvPage /></S></Need>} />
        </Route>

        {/* Full-screen — no sidebar */}
        <Route path="/player/:id" element={<Guard><Need media><S><PlayerPage  /></S></Need></Guard>} />
        <Route path="/reader/:id" element={<Guard><Need media><S><MangaReader /></S></Need></Guard>} />
        <Route path="/iptv/watch/:id" element={<Guard><Need iptv><S><IptvPlayer /></S></Need></Guard>} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
