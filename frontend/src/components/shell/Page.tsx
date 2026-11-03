import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronLeft, PanelLeft } from 'lucide-react'
import { cn } from '@/utils'
import { useShell } from './shellContext'
import { PHONE_PARENT } from './nav'

interface PageProps {
  title:      string
  /** Grey line under the title (desktop toolbar) */
  subtitle?:  React.ReactNode
  /** Buttons on the right of the toolbar / navigation bar */
  actions?:   React.ReactNode
  /** Under the title: search field, segmented control… (scrolls with the page on phone) */
  accessory?: React.ReactNode
  /** Back button (phone navigation bar; desktop toolbar too) */
  back?:      { to: string; label: string }
  /** No padding, content fills the area (terminal, readers) */
  bleed?:     boolean
  /** Keep content at a comfortable reading width */
  narrow?:    boolean
  /** Phone: show the large title (default) or only the compact bar */
  largeTitle?: boolean
  children:   React.ReactNode
  className?: string
}

/**
 * Page scaffold with the native chrome:
 * - desktop / tablet: unified toolbar (title, subtitle, actions), sticky
 * - phone: navigation bar + Large Title that shrinks into the bar on scroll
 */
export default function Page(props: PageProps) {
  const { device } = useShell()
  return device === 'phone' ? <PhonePage {...props} /> : <DesktopPage {...props} />
}

function DesktopPage({ title, subtitle, actions, accessory, back, bleed, narrow, children, className }: PageProps) {
  const { device, sidebarOpen, toggleSidebar } = useShell()
  useEffect(() => { document.title = `${title} — Nexus` }, [title])
  return (
    <div className={cn('flex flex-col', bleed ? 'h-full' : 'min-h-full')}>
      <header className="sticky top-0 z-30 material-bar hairline-b flex-shrink-0" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="flex items-center gap-2 min-h-[var(--toolbar-h)] px-4">
          {(device === 'tablet' || !sidebarOpen) && (
            <button
              type="button"
              onClick={toggleSidebar}
              className="w-8 h-8 grid place-items-center rounded-[6px] text-label2 hoverable -ml-1"
              aria-label={sidebarOpen ? 'Masquer la barre latérale' : 'Afficher la barre latérale'}
              aria-controls="nexus-sidebar"
              aria-expanded={sidebarOpen}
            >
              <PanelLeft size={18} strokeWidth={1.5} />
            </button>
          )}
          {back && (
            <Link to={back.to} className="w-8 h-8 grid place-items-center rounded-[6px] text-label2 hoverable -ml-1" aria-label={`Retour : ${back.label}`} title={back.label}>
              <ChevronLeft size={20} strokeWidth={1.75} />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-headline text-label truncate">{title}</h1>
            {subtitle && <div className="text-caption text-label2 truncate">{subtitle}</div>}
          </div>
          {actions && <div className="flex items-center gap-1.5 flex-shrink-0">{actions}</div>}
        </div>
        {accessory && <div className="px-4 pb-2.5">{accessory}</div>}
      </header>
      <div className={cn('flex-1 min-h-0', !bleed && 'px-6 py-5', className)}>
        {narrow && !bleed ? <div className="max-w-[880px] mx-auto">{children}</div> : children}
      </div>
    </div>
  )
}

function PhonePage({ title, actions, accessory, back, bleed, largeTitle = true, children, className }: PageProps) {
  const { pathname } = useLocation()
  const parent = back ?? PHONE_PARENT[pathname]
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [compact, setCompact] = useState(!largeTitle)
  useEffect(() => { document.title = `${title} — Nexus` }, [title])

  // The small title appears once the large one has scrolled under the bar
  useEffect(() => {
    const el = titleRef.current
    if (!el || !largeTitle) return
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), { rootMargin: '-52px 0px 0px 0px', threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [largeTitle])

  return (
    <div className={cn('flex flex-col', bleed ? 'h-full' : 'min-h-full')}>
      <header
        className={cn('sticky top-0 z-30 transition-[background-color,box-shadow] duration-fast', compact ? 'material-bar hairline-b' : 'bg-bg')}
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[var(--navbar-h)] safe-x" style={{ ['--gutter' as string]: '8px' }}>
          <div className="justify-self-start min-w-0">
            {parent && (
              <Link to={parent.to} className="flex items-center text-accent-text text-[17px] min-h-[44px] pr-2 active:opacity-50">
                <ChevronLeft size={28} strokeWidth={2} className="-mr-0.5 flex-shrink-0" aria-hidden="true" />
                <span className="truncate">{parent.label}</span>
              </Link>
            )}
          </div>
          <div
            className="text-[17px] font-semibold text-label truncate max-w-[52vw] transition-opacity duration-fast"
            style={{ opacity: compact ? 1 : 0 }}
            aria-hidden={!compact}
          >
            {title}
          </div>
          <div className="justify-self-end flex items-center gap-1 pr-1">{actions}</div>
        </div>
      </header>
      {largeTitle && (
        <div className="gutter safe-x pt-0.5 pb-2">
          <h1 ref={titleRef} className="text-largetitle text-label">{title}</h1>
        </div>
      )}
      {!largeTitle && <h1 className="sr-only">{title}</h1>}
      {accessory && <div className="gutter safe-x pb-3">{accessory}</div>}
      <div className={cn('flex-1 min-h-0', !bleed && 'gutter safe-x pb-6', className)}>{children}</div>
    </div>
  )
}
