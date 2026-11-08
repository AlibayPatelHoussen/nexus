import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronDown, Search, X } from 'lucide-react'
import PullDownMenu from '@/components/ui/PullDownMenu'
import { spring } from '@/design/motion'

export const VIDEO_SECTIONS = [
  { value: 'films',   label: 'Films',   to: '/cinema' },
  { value: 'series',  label: 'Séries',  to: '/cinema?type=series' },
  { value: 'animes',  label: 'Animes',  to: '/animes' },
  { value: 'youtube', label: 'YouTube', to: '/youtube' },
]

/** iPhone: « Films ⌄ » at the top left, a pull-down menu to switch section (the tab bar already says « Médias »). */
export function SectionMenu({ value }: { value: string }) {
  const navigate = useNavigate()
  // « Ma liste » too: on iPhone the tab bar has no room for it (desktop: in the sidebar)
  const sections = [...VIDEO_SECTIONS, { value: 'ma-liste', label: 'Ma liste', to: '/ma-liste' }]
  const current = sections.find((s) => s.value === value) ?? sections[0]
  return (
    <PullDownMenu
      label="Section"
      value={current.value}
      onChange={(v) => navigate(sections.find((s) => s.value === v)!.to)}
      options={sections.map(({ value: v, label }) => ({ value: v, label }))}
      className="h-11 pl-4 pr-3 text-[17px] font-semibold text-label"
    >
      {current.label}
      <ChevronDown size={17} strokeWidth={2.5} className="text-label2" aria-hidden="true" />
    </PullDownMenu>
  )
}

/** The magnifying glass in the bar's glass capsule; it morphs into the search field (shared layoutId). */
export function SearchButton({ onOpen, label }: { onOpen: () => void; label: string }) {
  return (
    <motion.button
      layoutId="phone-search"
      type="button"
      onClick={onOpen}
      className="w-11 h-11 grid place-items-center rounded-full text-label"
      aria-label={label}
      title={label}
      transition={spring.sheet}
    >
      <motion.span layoutId="phone-search-icon" transition={spring.sheet} className="grid place-items-center">
        <Search size={21} strokeWidth={2} />
      </motion.span>
    </motion.button>
  )
}

/** The open search field: a glass capsule across the bar and a round glass « × » that closes it. */
export function SearchBarOpen({ value, onChange, onClose, placeholder }: {
  value: string; onChange: (v: string) => void; onClose: () => void; placeholder: string
}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { const t = setTimeout(() => input.current?.focus(), 60); return () => clearTimeout(t) }, [])
  return (
    <>
      <motion.label layoutId="phone-search" transition={spring.sheet} className="flex-1 min-w-0 flex items-center gap-2 h-11 pl-3.5 pr-2 rounded-pill glass-bar text-label" role="search">
        <motion.span layoutId="phone-search-icon" transition={spring.sheet} className="grid place-items-center flex-shrink-0 text-label2">
          <Search size={18} strokeWidth={2} />
        </motion.span>
        <span className="sr-only">{placeholder}</span>
        <input
          ref={input}
          type="search"
          enterKeyHint="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-transparent outline-none text-[17px] text-label placeholder:text-label2 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {value && (
          <button type="button" onClick={() => { onChange(''); input.current?.focus() }} className="w-6 h-6 grid place-items-center rounded-full bg-label3 text-surface flex-shrink-0" aria-label="Effacer la recherche">
            <X size={13} strokeWidth={2.75} />
          </button>
        )}
      </motion.label>
      <motion.button
        type="button"
        onClick={onClose}
        className="w-11 h-11 flex-shrink-0 grid place-items-center rounded-full glass-bar text-label"
        aria-label="Fermer la recherche"
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={spring.sheet}
      >
        <X size={20} strokeWidth={2.25} />
      </motion.button>
    </>
  )
}
