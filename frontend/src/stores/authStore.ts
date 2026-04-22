import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User, Theme } from '@/types'

interface AuthStore {
  user:         User | null
  accessToken:  string | null
  isAuth:       boolean
  theme:        Theme

  setAuth:        (user: User, accessToken: string) => void
  setAccessToken: (token: string) => void
  setTheme:       (theme: Theme) => void
  logout:         () => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user:        null,
      accessToken: null,
      isAuth:      false,
      theme:       'dark',

      setAuth: (user, accessToken) => {
        set({ user, accessToken, isAuth: true })
      },

      setAccessToken: (accessToken) => {
        set({ accessToken })
      },

      setTheme: (theme) => {
        set({ theme })
        // Apply to <html>
        document.documentElement.className = theme
        // Save to server in background (fire & forget)
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
        isAuth: state.isAuth,
        // accessToken intentionally NOT persisted — refreshed via refresh token on next API call
      }),
    },
  ),
)
