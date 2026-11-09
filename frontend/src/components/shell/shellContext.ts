import { createContext, useContext } from 'react'
import type { Device } from '@/hooks/useDevice'

export interface ShellState {
  device:          Device
  /** Desktop: sidebar shown; tablet: sidebar panel open */
  sidebarOpen:     boolean
  toggleSidebar:   () => void
  openSearch:      () => void
}

export const ShellContext = createContext<ShellState>({
  device: 'desktop', sidebarOpen: true, toggleSidebar: () => {}, openSearch: () => {},
})

export const useShell = () => useContext(ShellContext)

/**
 * iPhone: each tab stays mounted while another one is shown (like iOS keeps each tab's
 * screen alive). False while the page sits in a hidden tab: live work (sockets) can pause.
 */
export const PageActiveContext = createContext(true)
export const usePageActive = () => useContext(PageActiveContext)
