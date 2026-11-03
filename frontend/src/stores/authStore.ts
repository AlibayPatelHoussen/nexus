import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Appearance, User, Theme } from '@/types'

interface AuthStore {
  user:         User | null
  accessToken:  string | null
  isAuth:       boolean
  theme:        Theme
  /** Auto / Clair / Sombre — Auto is local (the server only stores dark / light) */
  appearance:   Appearance

  setAuth:        (user: User, accessToken: string) => void
  setAccessToken: (token: string) => void
  setTheme:       (theme: Theme) => void
  setAppearance:  (appearance: Appearance) => void
  logout:         () => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user:        null,
      accessToken: null,
      isAuth:      false,
      theme:       'dark',
      appearance:  'auto',

      setAuth: (user, accessToken) => {
        set({ user, accessToken, isAuth: true })
      },

      setAccessToken: (accessToken) => {
        set({ accessToken })
      },

      setTheme: (theme) => {
        set({ theme })
        // Save to the server in the background (fire & forget)
        const token = useAuthStore.getState().accessToken
        if (token) {
          fetch('/api/auth/theme', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ theme }),
          }).catch(() => {})
        }
      },

      setAppearance: (appearance) => {
        set({ appearance })
        applyAppearance(appearance)
        if (appearance !== 'auto') useAuthStore.getState().setTheme(appearance)
      },

      logout: () => {
        const refreshToken = localStorage.getItem('nexus_refresh_token')
        if (refreshToken) {
          fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          }).catch(() => {})
          localStorage.removeItem('nexus_refresh_token')
        }
        set({ user: null, accessToken: null, isAuth: false })
      },
    }),
    {
      name:    'nexus-auth',
      partialize: (state) => ({
        user:   state.user,
        theme:  state.theme,
        appearance: state.appearance,
        isAuth: state.isAuth,
        // accessToken intentionally NOT persisted — refreshed via refresh token on next API call
      }),
    },
  ),
)

/** <html data-theme> forces light / dark; without it the system preference applies */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement
  if (appearance === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', appearance)
  root.removeAttribute('class')
}
