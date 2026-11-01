import { api, tokenExpiresAt } from './api'
import { useAuthStore } from '@/stores/authStore'

// Media elements (<video>, <img>, <iframe>) cannot send an Authorization
// header, so media URLs carry a short-lived, read-only *stream* token
// instead of the real access token.
let cached: { userId: string; token: string; exp: number } | null = null

/** Refetch when less than this many seconds of validity remain. */
const MIN_VALIDITY_S = 30 * 60

export async function getStreamToken(): Promise<string> {
  const userId = useAuthStore.getState().user?.id ?? ''
  const now    = Date.now() / 1000
  if (cached && cached.userId === userId && cached.exp - MIN_VALIDITY_S > now) return cached.token

  const { data } = await api.get<{ success: boolean; data?: { token?: string } }>('/auth/stream-token')
  const token = typeof data === 'object' && data ? data.data?.token : undefined
  // An outdated backend (or a proxy) can answer 200 with an HTML page
  if (typeof token !== 'string' || !token) {
    throw new Error('Réponse invalide du serveur pour l\'autorisation de lecture (backend pas à jour ?)')
  }
  cached = { userId, token, exp: tokenExpiresAt(token) ?? now + MIN_VALIDITY_S }
  return token
}

export function withStreamToken(url: string, token: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
}
