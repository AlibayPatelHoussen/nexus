import { useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, LayoutGroup } from 'framer-motion'
import { useAuthStore } from '@/stores/authStore'
import { spring } from '@/design/motion'
import { cn } from '@/utils'
import { TABS, tabFor } from './nav'

/**
 * iOS 26 tab bar (Apple's iOS 26 kit, "Tab Bar – iPhone"): a Liquid Glass
 * capsule floating above the content, 62 pt tall (54 pt tabs + 4 pt inset),
 * 25 pt from the screen sides. The selected tab sits in a lighter capsule that
 * slides on a spring; only it is tinted.
 */
export default function TabBar() {
  const { pathname } = useLocation()
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  // Title pages (/media/…) stay under the tab they were opened from
  const last = useRef(tabFor(pathname))
  const found = tabFor(pathname)
  if (found) last.current = found
  const current = found ?? last.current
  const tabs = TABS.filter((t) => isAdmin || !t.adminOnly)

  return (
    <nav
      aria-label="Onglets"
      className="fixed z-40 left-0 right-0 flex justify-center pointer-events-none"
      style={{
        bottom: 'var(--tabbar-bottom)',
        paddingLeft: 'max(21px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(21px, env(safe-area-inset-right, 0px))',
      }}
    >
      <LayoutGroup id="tabbar">
        <ul className="glass pointer-events-auto flex w-full max-w-[460px] h-[var(--tabbar-h)] p-1 rounded-pill">
          {tabs.map((t) => {
            const on = current?.to === t.to
            return (
              <li key={t.to} className="flex-1 flex min-w-0">
                <Link
                  to={t.to}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'no-press relative flex-1 flex flex-col items-center justify-center gap-px pt-1.5 pb-[7px] rounded-pill select-none',
                    'text-[10px] leading-3 font-[590] transition-[scale] duration-200 active:scale-95',
                    on ? 'text-accent' : 'text-[color:var(--glass-label)]',
                  )}
                >
                  {on && (
                    <motion.span
                      layoutId="tab-selection"
                      transition={spring.selection}
                      className="absolute inset-0 rounded-pill bg-[color:var(--glass-select)]"
                      aria-hidden="true"
                    />
                  )}
                  <t.icon size={23} strokeWidth={on ? 2.1 : 1.75} className="relative" aria-hidden="true" />
                  <span className="relative truncate max-w-full px-0.5">{t.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </LayoutGroup>
    </nav>
  )
}
