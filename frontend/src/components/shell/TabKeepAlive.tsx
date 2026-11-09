import { useRef, type ReactNode } from 'react'
import { UNSAFE_LocationContext, useLocation, useNavigationType, useOutlet } from 'react-router-dom'
import { tabFor } from './nav'
import { PageActiveContext } from './shellContext'

/**
 * iPhone: like iOS, each tab keeps its screen alive while another tab is shown. Coming back
 * to a tab shows it at once, as it was left (no rebuild, no image reloaded, scroll kept),
 * instead of building the whole page again at every switch.
 *
 * Each tab keeps its current page; a page opened inside a tab replaces that tab's page.
 * A hidden page keeps the location it was shown at (so it does not react to the other
 * tab's URL) and is told it is not active (live work pauses). The shown page's wrapper is
 * display: contents, so the layout is exactly as without it.
 */
export default function TabKeepAlive() {
  const outlet = useOutlet()
  const location = useLocation()
  const navigationType = useNavigationType()
  const lastKey = useRef('')
  const pages = useRef(new Map<string, { at: string; node: ReactNode }>())

  // Pages outside the tabs (a title page…) belong to the tab they were opened from
  const key = tabFor(location.pathname)?.to ?? (lastKey.current || location.pathname)
  lastKey.current = key
  const at = location.pathname + location.search
  const kept = pages.current.get(key)
  if (!kept || kept.at !== at) {
    pages.current.set(key, {
      at,
      node: <UNSAFE_LocationContext.Provider value={{ location, navigationType }}>{outlet}</UNSAFE_LocationContext.Provider>,
    })
  }

  return (
    <>
      {[...pages.current].map(([k, page]) => {
        const shown = k === key
        return (
          <div key={k} data-page={shown ? 'current' : undefined} style={{ display: shown ? 'contents' : 'none' }} aria-hidden={!shown || undefined}>
            <PageActiveContext.Provider value={shown}>{page.node}</PageActiveContext.Provider>
          </div>
        )
      })}
    </>
  )
}
