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
  /** Full-bleed artwork at the top (Apple TV billboard): the toolbar / large title float over it,
      in white, and turn into the normal glass bar once it has scrolled away */
  hero?:      React.ReactNode
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

/** True once the page scrolled past `limit` px (the scroller is #main on desktop, the window on phones). */
function useScrolledPast(limit: number, enabled: boolean, phone: boolean) {
  const [past, setPast] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const el: HTMLElement | Window = phone ? window : (document.getElementById('main') ?? window)
    const read = () => setPast((el === window ? window.scrollY : (el as HTMLElement).scrollTop) > limit)
    read()
    el.addEventListener('scroll', read, { passive: true })
    return () => el.removeEventListener('scroll', read)
  }, [limit, enabled, phone])
  return past
}

function DesktopPage({ title, subtitle, actions, accessory, back, bleed, narrow, hero, children, className }: PageProps) {
  const { device, sidebarOpen, toggleSidebar } = useShell()
  useEffect(() => { document.title = `${title} — Nexus` }, [title])
  const overHero = useScrolledPast(typeof window === 'undefined' ? 400 : window.innerHeight * 0.5, !!hero, false)
  const onMedia = !!hero && !overHero
  return (
    <div className={cn('flex flex-col', bleed ? 'h-full' : 'min-h-full')}>
      {hero && (
        // Full width, under the floating sidebar too; the toolbar floats over it
        <div className="relative order-2" style={{ marginLeft: 'calc(-1 * var(--content-left))' }}>{hero}</div>
      )}
      <header
        className={cn(
          'sticky top-0 z-30 flex-shrink-0 transition-[background-color,box-shadow,color] duration-300',
          hero ? 'order-1 -mb-[var(--hero-bar-h)] h-[var(--hero-bar-h)]' : 'edge-bar',
          hero && (onMedia ? 'scheme-dark bg-transparent' : 'edge-bar'),
        )}
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)', ['--hero-bar-h' as string]: accessory ? '96px' : '52px' }}
      >
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
      <div className={cn('flex-1 min-h-0 order-3', !bleed && 'px-[var(--page-x)] py-5', hero && 'pt-8', className)}
        style={hero ? { ['--page-x' as string]: 'var(--shelf-x)' } : undefined}>
        {narrow && !bleed ? <div className="max-w-[880px] mx-auto">{children}</div> : children}
      </div>
    </div>
  )
}

function PhonePage({ title, actions, accessory, back, bleed, largeTitle = true, hero, children, className }: PageProps) {
  const { pathname } = useLocation()
  const parent = back ?? PHONE_PARENT[pathname]
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [compact, setCompact] = useState(!largeTitle)
  const scrolledPastHero = useScrolledPast(typeof window === 'undefined' ? 400 : window.innerHeight * 0.55, !!hero, true)
  useEffect(() => { document.title = `${title} — Nexus` }, [title])

  // The small title appears once the large one has scrolled under the bar
  useEffect(() => {
    const el = titleRef.current
    if (!el || !largeTitle) return
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), { rootMargin: '-52px 0px 0px 0px', threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [largeTitle])

  if (hero) {
    // Apple TV (iPhone): the large title and its accessory float over the billboard, in white;
    // the navigation bar is transparent until the billboard has scrolled away.
    const barSolid = scrolledPastHero
    return (
      <div className="flex flex-col min-h-full">
        <header
          className={cn('sticky top-0 z-30 transition-[background-color,box-shadow] duration-300 -mb-[calc(var(--navbar-h)+env(safe-area-inset-top,0px))]',
            barSolid ? 'edge-bar' : 'scheme-dark bg-transparent')}
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[var(--navbar-h)] safe-x" style={{ ['--gutter' as string]: '8px' }}>
            <div className="justify-self-start min-w-0">
              {parent && (
                <Link to={parent.to} aria-label={`Retour : ${parent.label}`}
                  className={cn('flex items-center justify-center w-11 h-11 ml-1 rounded-full text-label active:opacity-60', !barSolid && 'glass-clear w-10 h-10')}>
                  <ChevronLeft size={26} strokeWidth={2.25} className="-ml-0.5" aria-hidden="true" />
                </Link>
              )}
            </div>
            <div className="text-[17px] font-semibold text-label truncate max-w-[52vw] transition-opacity duration-fast" style={{ opacity: barSolid ? 1 : 0 }} aria-hidden={!barSolid}>{title}</div>
            <div className="justify-self-end flex items-center gap-1 pr-1">{actions}</div>
          </div>
        </header>
        <div className="relative">
          {hero}
          <div className="absolute inset-x-0 top-0 scheme-dark" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + var(--navbar-h))' }}>
            {largeTitle ? (
              <div className="gutter safe-x pt-0.5 pb-2">
                <h1 ref={titleRef} className="text-largetitle text-label [text-shadow:0_1px_12px_rgba(0,0,0,0.25)]">{title}</h1>
              </div>
            ) : <h1 className="sr-only">{title}</h1>}
            {accessory && <div className="gutter safe-x pb-3">{accessory}</div>}
          </div>
        </div>
        {/* Same gutter as the shelves (Apple TV: 25 px) */}
        <div className={cn('flex-1 min-h-0 safe-x pb-6 pt-7', className)} style={{ ['--page-x' as string]: 'var(--shelf-x)', ['--gutter' as string]: 'var(--shelf-x)' }}>{children}</div>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col', bleed ? 'h-full' : 'min-h-full')}>
      <header
        className={cn('sticky top-0 z-30 transition-[background-color,box-shadow] duration-fast', compact ? 'edge-bar' : 'bg-bg')}
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
      <div className={cn('flex-1 min-h-0', !bleed && 'gutter safe-x pb-6', !bleed && !largeTitle && !accessory && 'pt-4', className)}>{children}</div>
    </div>
  )
}
