import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { getServerHealth } from '@/services/versionService'

/**
 * What this page may show:
 * - the account's access: « Médias + IPTV », « Médias », « IPTV seulement » (admins: everything);
 * - the address: Nexus opened at the IPTV's own subdomain (Réglages › IPTV › Adresse, or any
 *   « iptv. » address) shows the IPTV only.
 */
export interface Access {
  admin: boolean
  /** The media pages (films, series, animes, manga, downloads, Aperçu) */
  media: boolean
  /** The IPTV */
  iptv: boolean
  /** This page is the IPTV's subdomain: the IPTV only */
  iptvHost: boolean
  /** The IPTV subdomain's address, when one is set */
  iptvUrl: string | null
}

const URL_KEY = 'nexus_iptv_url'

/** The IPTV address known on this device (from /api/health), before the answer comes. */
export function rememberedIptvUrl(): string | null {
  try { return localStorage.getItem(URL_KEY) } catch { return null }
}
export function rememberIptvUrl(url: string | null | undefined) {
  try {
    if (url) localStorage.setItem(URL_KEY, url)
    else localStorage.removeItem(URL_KEY)
  } catch { /* private mode */ }
}

export function isIptvHost(iptvUrl: string | null, loc: Pick<Location, 'host' | 'hostname'> = window.location): boolean {
  if (iptvUrl) {
    try { if (new URL(iptvUrl).host === loc.host) return true } catch { /* not an address */ }
  }
  return /^iptv\./i.test(loc.hostname)
}

export function accessOf(
  user: { role?: string; canMedia?: boolean; canIptv?: boolean } | null | undefined,
  iptvUrl: string | null,
  loc?: Pick<Location, 'host' | 'hostname'>,
): Access {
  const admin = user?.role === 'admin'
  const iptvHost = isIptvHost(iptvUrl, loc)
  return {
    admin,
    media: !iptvHost && (admin || user?.canMedia !== false),
    iptv: admin || user?.canIptv !== false,
    iptvHost,
    iptvUrl,
  }
}

export function useAccess(): Access {
  const user = useAuthStore((s) => s.user)
  const { data } = useQuery({ queryKey: ['server-health'], queryFn: getServerHealth, staleTime: 60_000, retry: 1 })
  const iptvUrl = data ? data.iptvUrl ?? null : rememberedIptvUrl()
  return useMemo(() => accessOf(user, iptvUrl), [user, iptvUrl])
}

/**
 * The IPTV has a tab (and a sidebar section) of its own for « user » accounts and accounts
 * without the media; admins find it under Médias.
 */
export const iptvTab = (a: Access) => a.iptv && (!a.media || !a.admin)

/** Where « / » leads: Aperçu with the media, else the IPTV. */
export const homePath = (a: Access) => (a.media ? '/dashboard' : '/iptv')

/** Whether a sidebar item / tab may show. */
export function canSee(item: { adminOnly?: boolean; need?: 'media' | 'iptv'; settings?: boolean }, a: Access): boolean {
  if (item.settings) return true
  if (item.adminOnly && !a.admin) return false
  // The IPTV's subdomain: the IPTV and the settings only
  if (a.iptvHost) return item.need === 'iptv'
  if (item.need === 'media') return a.media
  if (item.need === 'iptv') return a.iptv
  return true
}
