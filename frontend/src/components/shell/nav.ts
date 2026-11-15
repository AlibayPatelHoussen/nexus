import {
  Activity, BookOpen, Bot, Download, Film, Folder, Gauge, ListPlus, RadioTower, Settings, SquareTerminal, Tv, Wifi, Youtube,
  type LucideIcon,
} from 'lucide-react'
import { canSee, type Access } from './access'

export interface NavItem {
  to:        string
  label:     string
  icon:      LucideIcon
  section:   'server' | 'media' | 'settings'
  /** Not for « user » accounts (médias, manga, their downloads and the storage only) */
  adminOnly?: boolean
  /** Shown to accounts that have the media / the IPTV (components/shell/access.ts) */
  need?:     'media' | 'iptv'
  settings?: boolean
  /** Other words the ⌘K search should match */
  keywords?: string
}

/** Sidebar (desktop / tablet): every destination, grouped. */
export const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Vue d’ensemble', icon: Gauge,          section: 'server', need: 'media', keywords: 'accueil aperçu processeur mémoire disque' },
  { to: '/jarvis',    label: 'Jarvis',         icon: Bot,            section: 'server', adminOnly: true, keywords: 'assistant ia intelligence artificielle chat aide vocal' },
  { to: '/files',     label: 'Fichiers',       icon: Folder,         section: 'server', adminOnly: true, keywords: 'dossiers explorateur' },
  { to: '/terminal',  label: 'Terminal',       icon: SquareTerminal, section: 'server', adminOnly: true, keywords: 'shell console bash ssh' },
  { to: '/services',  label: 'Services',       icon: Activity,       section: 'server', adminOnly: true, keywords: 'systemd démarrer arrêter' },
  { to: '/network',   label: 'Réseau',         icon: Wifi,           section: 'server', adminOnly: true, keywords: 'ip interface' },
  { to: '/ma-liste',  label: 'Ma liste',       icon: ListPlus,       section: 'media',  need: 'media', keywords: 'favoris à voir plus tard' },
  { to: '/cinema',    label: 'Films et séries', icon: Film,          section: 'media',  need: 'media', keywords: 'cinéma vidéo' },
  { to: '/animes',    label: 'Animes',         icon: Tv,             section: 'media',  need: 'media' },
  { to: '/youtube',   label: 'YouTube',        icon: Youtube,        section: 'media',  need: 'media', keywords: 'vidéos chaînes' },
  { to: '/iptv',      label: 'IPTV',           icon: RadioTower,     section: 'media',  need: 'iptv', keywords: 'télévision tv direct live chaînes m3u iptv-org' },
  { to: '/manga',     label: 'Manga',          icon: BookOpen,       section: 'media',  need: 'media', keywords: 'scans webtoon lecture' },
  { to: '/downloads', label: 'Téléchargements', icon: Download,      section: 'media',  need: 'media', keywords: 'télécharger anime-sama movix youtube file d’attente' },
  { to: '/settings',  label: 'Réglages',       icon: Settings,       section: 'settings', settings: true, keywords: 'apparence compte mot de passe' },
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
  need?:   'media' | 'iptv'
  settings?: boolean
  /** Only without the media (« IPTV seulement », the IPTV's subdomain): with them, the IPTV is under Médias */
  withoutMedia?: boolean
}

/** Tab Bar (phone). Jarvis, files, services and network open from "Aperçu"; downloads from "Médias". */
export const TABS: Tab[] = [
  { to: '/dashboard', label: 'Aperçu',   icon: Gauge,          match: ['/dashboard', '/jarvis', '/files', '/services', '/network'], need: 'media' },
  { to: '/cinema',    label: 'Médias',   icon: Film,           match: ['/cinema', '/animes', '/youtube', '/downloads', '/ma-liste', '/iptv'], need: 'media' },
  { to: '/iptv',      label: 'IPTV',     icon: RadioTower,     match: ['/iptv'], need: 'iptv', withoutMedia: true },
  { to: '/manga',     label: 'Manga',    icon: BookOpen,       match: ['/manga'], need: 'media' },
  { to: '/terminal',  label: 'Terminal', icon: SquareTerminal, match: ['/terminal'], adminOnly: true },
  { to: '/settings',  label: 'Réglages', icon: Settings,       match: ['/settings'], settings: true },
]

/** Phone: pages pushed inside a tab get a "‹ back" button to the tab root. */
export const PHONE_PARENT: Record<string, { to: string; label: string }> = {
  '/jarvis':   { to: '/dashboard', label: 'Aperçu' },
  '/files':    { to: '/dashboard', label: 'Aperçu' },
  '/services': { to: '/dashboard', label: 'Aperçu' },
  '/network':  { to: '/dashboard', label: 'Aperçu' },
  '/downloads': { to: '/cinema', label: 'Médias' },
  '/ma-liste':  { to: '/cinema', label: 'Médias' },
}

/** The tabs this account sees here (the IPTV tab only without the media). */
export function tabsFor(a: Access): Tab[] {
  return TABS.filter((t) => canSee(t, a) && (!t.withoutMedia || !a.media))
}

export function tabFor(pathname: string, tabs: Tab[] = TABS): Tab | undefined {
  return tabs.find((t) => t.match.some((m) => pathname === m || pathname.startsWith(m + '/')))
}

export function navFor(pathname: string): NavItem | undefined {
  return NAV.find((n) => pathname === n.to || pathname.startsWith(n.to + '/'))
}
