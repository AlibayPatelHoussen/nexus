import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { spring } from '@/design/motion'

interface Props {
  open:     boolean
  title:    string
  onClose:  () => void
  children: React.ReactNode
}

/**
 * Glass panel over the video (« Épisodes », « Diffuser »): inside the player so it also
 * shows in full screen. Slides in from the trailing edge on a spring.
 */
export default function PlayerPanel({ open, title, onClose, children }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-label={title}
          className="absolute z-30 top-2 bottom-2 right-2 w-[min(360px,calc(100%-16px))] glass-media glass-media-dense rounded-[26px] flex flex-col overflow-hidden"
          initial={{ opacity: 0, x: 40, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 40, scale: 0.98 }}
          transition={spring.sheet}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
        >
          <div className="flex items-center gap-2 pl-4 pr-1.5 pt-1.5 pb-1">
            <h2 className="flex-1 min-w-0 truncate text-[17px] font-semibold">{title}</h2>
            <button type="button" className="w-11 h-11 grid place-items-center rounded-full hover:bg-white/10 active:bg-white/20" onClick={onClose} aria-label="Fermer" autoFocus>
              <X size={20} strokeWidth={2} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-2 pb-2">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** A row of a player panel (episode, TV…): 44 pt minimum, selected = tinted. */
export function PanelRow({ icon, title, subtitle, selected, disabled, onClick }: {
  icon?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; selected?: boolean; disabled?: boolean; onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-current={selected || undefined}
      className={`w-full min-h-[48px] flex items-center gap-3 px-3 py-2 rounded-[18px] text-left transition-colors disabled:opacity-45 ${selected ? 'bg-white/20' : 'hover:bg-white/10 active:bg-white/20'}`}
    >
      {icon && <span className="w-8 h-8 grid place-items-center flex-shrink-0 text-white/90">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium truncate">{title}</span>
        {subtitle && <span className="block text-[12px] text-white/60 truncate">{subtitle}</span>}
      </span>
    </button>
  )
}
