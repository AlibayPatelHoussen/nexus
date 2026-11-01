import axios from 'axios'
import { useAuthStore } from '@/stores/authStore'

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// ── Token helpers ────────────────────────────────────
let refreshing: Promise<string> | null = null

/** Get a new access token from the refresh token (concurrent calls share one request). */
export function refreshAccessToken(): Promise<string> {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = localStorage.getItem('nexus_refresh_token')
      if (!refreshToken) throw new Error('No refresh token')
      const { data } = await axios.post('/api/auth/refresh', { refreshToken })
      const token = data.data.accessToken as string
      useAuthStore.getState().setAccessToken(token)
      return token
    })().finally(() => { refreshing = null })
  }
  return refreshing
}

/** Seconds before expiry at which a token is considered stale. */
const EXPIRY_MARGIN_S = 30

export function tokenExpiresAt(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}

/** Current access token, refreshed first if missing or about to expire. */
export async function getFreshAccessToken(): Promise<string> {
  const token = useAuthStore.getState().accessToken
  const exp   = token ? tokenExpiresAt(token) : null
  if (token && exp && exp - EXPIRY_MARGIN_S > Date.now() / 1000) return token
  return refreshAccessToken()
}

// ── Request interceptor: attach token ────────────────
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Response interceptor: handle 401 / refresh ───────
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config

    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true

      try {
        const token = await refreshAccessToken()
        original.headers.Authorization = `Bearer ${token}`
        return api(original)
      } catch {
        useAuthStore.getState().logout()
        return Promise.reject(error)
      }
    }

    return Promise.reject(error)
  },
)
