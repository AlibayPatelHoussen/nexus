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
