import {
  Activity, BookOpen, Download, Film, Folder, Gauge, ListPlus, RadioTower, Settings, SquareTerminal, Tv, Wifi, Youtube,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to:        string
  label:     string
  icon:      LucideIcon
  section:   'server' | 'media' | 'settings'
  adminOnly?: boolean
  /** Other words the ⌘K search should match */
  keywords?: string
}

/** Sidebar (desktop / tablet): every destination, grouped. */
export const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Vue d’ensemble', icon: Gauge,          section: 'server', keywords: 'accueil aperçu processeur mémoire disque' },
  { to: '/files',     label: 'Fichiers',       icon: Folder,         section: 'server', adminOnly: true, keywords: 'dossiers explorateur' },
  { to: '/terminal',  label: 'Terminal',       icon: SquareTerminal, section: 'server', adminOnly: true, keywords: 'shell console bash ssh' },
  { to: '/services',  label: 'Services',       icon: Activity,       section: 'server', keywords: 'systemd démarrer arrêter' },
  { to: '/network',   label: 'Réseau',         icon: Wifi,           section: 'server', keywords: 'ip interface' },
  { to: '/ma-liste',  label: 'Ma liste',       icon: ListPlus,       section: 'media',  keywords: 'favoris à voir plus tard' },
  { to: '/cinema',    label: 'Films et séries', icon: Film,          section: 'media',  keywords: 'cinéma vidéo' },
  { to: '/animes',    label: 'Animes',         icon: Tv,             section: 'media' },
  { to: '/youtube',   label: 'YouTube',        icon: Youtube,        section: 'media',  keywords: 'vidéos chaînes' },
  { to: '/iptv',      label: 'IPTV',           icon: RadioTower,     section: 'media',  keywords: 'télévision tv direct live chaînes m3u iptv-org' },
  { to: '/manga',     label: 'Manga',          icon: BookOpen,       section: 'media',  keywords: 'scans webtoon lecture' },
  { to: '/downloads', label: 'Téléchargements', icon: Download,      section: 'media',  adminOnly: true, keywords: 'télécharger anime-sama movix youtube file d’attente' },
  { to: '/settings',  label: 'Réglages',       icon: Settings,       section: 'settings', keywords: 'apparence compte mot de passe' },
]

export const SECTIONS: { id: NavItem['section']; label: string }[] = [
  { id: 'server', label: 'Serveur' },
  { id: 'media',  label: 'Médias' },
]

export interface Tab {
  to:      string
  label:   string
  icon:    LucideIcon
  /** Routes shown inside this tab (the tab stays selected) */
  match:   string[]
  adminOnly?: boolean
}

/** Tab Bar (phone). Files, services and network open from "Aperçu"; downloads from "Médias". */
export const TABS: Tab[] = [
  { to: '/dashboard', label: 'Aperçu',   icon: Gauge,          match: ['/dashboard', '/files', '/services', '/network'] },
  { to: '/cinema',    label: 'Médias',   icon: Film,           match: ['/cinema', '/animes', '/youtube', '/downloads', '/ma-liste', '/iptv'] },
  { to: '/manga',     label: 'Manga',    icon: BookOpen,       match: ['/manga'] },
  { to: '/terminal',  label: 'Terminal', icon: SquareTerminal, match: ['/terminal'], adminOnly: true },
  { to: '/settings',  label: 'Réglages', icon: Settings,       match: ['/settings'] },
]

/** Phone: pages pushed inside a tab get a "‹ back" button to the tab root. */
export const PHONE_PARENT: Record<string, { to: string; label: string }> = {
  '/files':    { to: '/dashboard', label: 'Aperçu' },
  '/services': { to: '/dashboard', label: 'Aperçu' },
  '/network':  { to: '/dashboard', label: 'Aperçu' },
  '/downloads': { to: '/cinema', label: 'Médias' },
  '/ma-liste':  { to: '/cinema', label: 'Médias' },
}

export function tabFor(pathname: string): Tab | undefined {
  return TABS.find((t) => t.match.some((m) => pathname === m || pathname.startsWith(m + '/')))
}

export function navFor(pathname: string): NavItem | undefined {
  return NAV.find((n) => pathname === n.to || pathname.startsWith(n.to + '/'))
}
