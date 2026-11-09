import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { PHONE_PARENT, tabFor } from './nav'
import type { Device } from '@/hooks/useDevice'

/** How deep a page is in its tab: tab root 1, pushed page 2, title page 3. */
function depth(pathname: string): number {
  if (pathname.startsWith('/media/')) return 3
  return PHONE_PARENT[pathname] ? 2 : 1
}

type Motion = 'push' | 'pop' | 'switch'

function motionFor(from: string, to: string): Motion {
  const a = depth(from), b = depth(to)
  if (b > a) return 'push'
  if (b < a) return 'pop'
  return 'switch'
}

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'   // iOS navigation

function keyframes(device: Device, motion: Motion): [Keyframe[], number] {
  if (device === 'phone') {
    if (motion === 'push') return [[{ transform: 'translateX(32%)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], 420]
    if (motion === 'pop')  return [[{ transform: 'translateX(-24%)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], 380]
    // Tab switch: the new tab is simply there (iOS / Apple Music: no fade, which flashed)
    return [[], 0]
  }
  // Mac: content changes in place with a short fade, pushed pages rise slightly
  if (motion === 'push') return [[{ transform: 'translateY(8px) scale(0.995)', opacity: 0 }, { transform: 'none', opacity: 1 }], 320]
  return [[{ opacity: 0 }, { opacity: 1 }], 180]
}

/**
 * Native navigation feel:
 * - the new page slides in like a UINavigationController push / pop on
 *   phones, fades in on Mac and iPad;
 * - each page has its own scroll position: a new page opens at the top,
 *   "back" finds the previous one where it was left.
 */
export function useRouteMotion(frame: () => HTMLElement | null, device: Device, scroller: () => HTMLElement | Window | null) {
  const location = useLocation()
  const navType = useNavigationType()
  const prev = useRef(location.pathname)
  const scrolls = useRef(new Map<string, number>())
  const key = useRef(location.key)

  // Remember where each page was scrolled to
  useEffect(() => {
    const el = scroller()
    if (!el) return
    const onScroll = () => {
      const y = el instanceof Window ? el.scrollY : el.scrollTop
      scrolls.current.set(key.current, y)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scroller, device])

  useLayoutEffect(() => {
    const from = prev.current
    const to = location.pathname
    prev.current = to
    key.current = location.key
    if (from === to) return

    const el = scroller()
    const y = navType === 'POP' ? scrolls.current.get(location.key) ?? 0 : 0
    if (el instanceof Window) el.scrollTo(0, y)
    else el?.scrollTo(0, y)

    // The page is the frame's last child (after the version banner); no extra
    // wrapper, so full-height pages and sticky bars keep working
    const node = frame()?.lastElementChild as HTMLElement | null | undefined
    if (!node || typeof node.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    // Switching tabs from the tab bar: no slide (iOS does not either)
    const sameTab = tabFor(from)?.to === tabFor(to)?.to || to.startsWith('/media/') || from.startsWith('/media/')
    const motion = sameTab ? motionFor(from, to) : 'switch'
    const [frames, duration] = keyframes(device, motion)
    if (duration) node.animate(frames, { duration, easing: EASE })
  }, [location.pathname, location.key, navType, device, frame, scroller])
}
