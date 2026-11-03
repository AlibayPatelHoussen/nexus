import { Link, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/utils'
import { TABS, tabFor } from './nav'

/** iOS tab bar: translucent, fixed at the bottom, above the home indicator. */
export default function TabBar() {
  const { pathname } = useLocation()
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const current = tabFor(pathname)
  const tabs = TABS.filter((t) => isAdmin || !t.adminOnly)

  return (
    <nav
      aria-label="Onglets"
      className="fixed inset-x-0 bottom-0 z-40 material-bar hairline-t"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)', paddingLeft: 'env(safe-area-inset-left, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)' }}
    >
      <ul className="grid h-[var(--tabbar-h)]" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => {
          const on = current?.to === t.to
          return (
            <li key={t.to} className="flex">
              <Link
                to={t.to}
                aria-current={on ? 'page' : undefined}
                className={cn('flex-1 flex flex-col items-center justify-center gap-[2px] pt-[3px] text-[10px] font-medium select-none active:opacity-60', on ? 'text-accent' : 'text-label2')}
              >
                <t.icon size={25} strokeWidth={on ? 1.9 : 1.5} aria-hidden="true" />
                <span>{t.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
