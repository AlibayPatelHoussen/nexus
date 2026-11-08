import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, lazy, Suspense } from 'react'
import { applyAppearance, useAuthStore } from '@/stores/authStore'
import AppShell      from '@/components/shell/AppShell'
import LoginPage     from '@/pages/login/LoginPage'
import DashboardPage from '@/pages/dashboard/DashboardPage'
import NotFoundPage  from '@/pages/NotFoundPage'
import Spinner       from '@/components/ui/Spinner'

const FilesPage    = lazy(() => import('@/pages/files/FilesPage'))
const TerminalPage = lazy(() => import('@/pages/terminal/TerminalPage'))
const CinemaPage   = lazy(() => import('@/pages/cinema/CinemaPage'))
const AnimesPage   = lazy(() => import('@/pages/animes/AnimesPage'))
const MangaPage    = lazy(() => import('@/pages/manga/MangaPage'))
const ServicesPage = lazy(() => import('@/pages/services/ServicesPage'))
const NetworkPage  = lazy(() => import('@/pages/network/NetworkPage'))
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'))
const DownloadsPage = lazy(() => import('@/pages/downloads/DownloadsPage'))
const YoutubePage  = lazy(() => import('@/pages/youtube/YoutubePage'))
const MyListPage   = lazy(() => import('@/pages/mylist/MyListPage'))
const PlayerPage   = lazy(() => import('@/pages/player/PlayerPage'))
const MangaReader  = lazy(() => import('@/pages/player/MangaReaderPage'))
const MediaDetail  = lazy(() => import('@/pages/media/MediaDetailPage'))

function PageLoader() {
  return <div className="flex items-center justify-center h-full min-h-[300px]"><Spinner /></div>
}

function Guard({ children }: { children: React.ReactNode }) {
  const isAuth = useAuthStore((s) => s.isAuth)
  return isAuth ? <>{children}</> : <Navigate to="/login" replace />
}

function S({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

export default function App() {
  const appearance = useAuthStore((s) => s.appearance)

  useEffect(() => { applyAppearance(appearance) }, [appearance])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* App frame: sidebar / tab bar */}
        <Route path="/" element={<Guard><AppShell /></Guard>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="files"     element={<S><FilesPage    /></S>} />
          <Route path="terminal"  element={<S><TerminalPage /></S>} />
          <Route path="cinema"    element={<S><CinemaPage   /></S>} />
          <Route path="animes"    element={<S><AnimesPage   /></S>} />
          <Route path="manga"     element={<S><MangaPage    /></S>} />
          <Route path="services"  element={<S><ServicesPage /></S>} />
          <Route path="network"   element={<S><NetworkPage  /></S>} />
          <Route path="settings"  element={<S><SettingsPage /></S>} />
          <Route path="downloads" element={<S><DownloadsPage /></S>} />
          <Route path="youtube"   element={<S><YoutubePage /></S>} />
          <Route path="ma-liste"  element={<S><MyListPage /></S>} />
          <Route path="media/:id" element={<S><MediaDetail  /></S>} />
        </Route>

        {/* Full-screen — no sidebar */}
        <Route path="/player/:id" element={<Guard><S><PlayerPage  /></S></Guard>} />
        <Route path="/reader/:id" element={<Guard><S><MangaReader /></S></Guard>} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
