import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, LogOut, Monitor, Moon, Search, Sun, type LucideIcon } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/utils'
import { useModal, usePresence } from '@/components/ui/useSheetLifecycle'
import { NAV } from './nav'

interface Command { id: string; label: string; group: string; icon: LucideIcon; keywords?: string; run: () => void }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Spotlight-like quick search: pages and common actions (⌘K / Ctrl K). */
export default function CommandPalette({ open, onClose, onLogout }: { open: boolean; onClose: () => void; onLogout: () => void }) {
  const navigate = useNavigate()
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const setAppearance = useAuthStore((s) => s.setAppearance)
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const { mounted, closing } = usePresence(open, 150)
  const ref = useModal(open, onClose, input)

  useEffect(() => { if (open) { setQ(''); setIndex(0) } }, [open])

  const commands = useMemo<Command[]>(() => [
    ...NAV.filter((n) => isAdmin || !n.adminOnly).map((n) => ({
      id: n.to, label: n.label, group: 'Aller à', icon: n.icon, keywords: n.keywords, run: () => navigate(n.to),
    })),
    { id: 'light', label: 'Apparence claire', group: 'Actions', icon: Sun, keywords: 'thème mode clair', run: () => setAppearance('light') },
    { id: 'dark', label: 'Apparence sombre', group: 'Actions', icon: Moon, keywords: 'thème mode sombre nuit', run: () => setAppearance('dark') },
    { id: 'auto', label: 'Apparence automatique', group: 'Actions', icon: Monitor, keywords: 'thème système auto', run: () => setAppearance('auto') },
    { id: 'logout', label: 'Se déconnecter', group: 'Actions', icon: LogOut, keywords: 'déconnexion quitter', run: onLogout },
  ], [isAdmin, navigate, setAppearance, onLogout])

  const results = useMemo(() => {
    const n = norm(q.trim())
    if (!n) return commands
    return commands.filter((c) => norm(`${c.label} ${c.keywords ?? ''}`).includes(n))
  }, [q, commands])

  useEffect(() => { setIndex(0) }, [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!mounted) return null
  const run = (c: Command) => { onClose(); c.run() }

  let lastGroup = ''
  return createPortal(
    <div className="fixed inset-0 z-[140]">
      <div className="absolute inset-0" onClick={onClose} style={{ background: 'rgba(0,0,0,.12)', animation: `nx-fade-in 150ms ${closing ? 'reverse' : ''} both` }} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Recherche"
        className="absolute left-1/2 top-[18vh] -translate-x-1/2 w-[min(640px,calc(100vw-32px))] rounded-[14px] material-bar overflow-hidden"
        style={{ boxShadow: 'var(--shadow-sheet)', animation: closing ? 'nx-pop 120ms var(--ease-out) reverse both' : 'nx-pop 180ms var(--ease-out) both' }}
      >
        <div className="flex items-center gap-2.5 px-4 h-[52px]">
          <Search size={20} strokeWidth={1.5} className="text-label2 flex-shrink-0" aria-hidden="true" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { setIndex((i) => Math.min(i + 1, results.length - 1)); e.preventDefault() }
              else if (e.key === 'ArrowUp') { setIndex((i) => Math.max(i - 1, 0)); e.preventDefault() }
              else if (e.key === 'Enter' && results[index]) { run(results[index]); e.preventDefault() }
            }}
            placeholder="Rechercher dans Nexus"
            aria-label="Rechercher dans Nexus"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[index] ? `palette-${results[index].id}` : undefined}
            className="flex-1 bg-transparent outline-none text-[20px] font-light text-label placeholder:text-label3"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <ul id="palette-results" ref={listRef} role="listbox" aria-label="Résultats" className="max-h-[360px] overflow-y-auto px-2 pb-2 hairline-t pt-1">
          {results.length === 0 && <li className="px-3 py-6 text-center text-label2">Aucun résultat pour « {q} »</li>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null
            lastGroup = c.group
            return (
              <li key={c.id} role="presentation">
                {header && <div className="px-2.5 pt-2 pb-1 text-caption font-semibold text-label2">{header}</div>}
                <div
                  id={`palette-${c.id}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === index}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => run(c)}
                  className={cn('flex items-center gap-2.5 h-[34px] px-2.5 rounded-[7px] text-body', i === index ? 'bg-accent text-white' : 'text-label')}
                >
                  <c.icon size={16} strokeWidth={1.5} className={i === index ? 'text-white' : 'text-accent'} aria-hidden="true" />
                  <span className="flex-1 truncate">{c.label}</span>
                  {i === index && <CornerDownLeft size={14} strokeWidth={1.75} aria-hidden="true" />}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>,
    document.body,
  )
}
