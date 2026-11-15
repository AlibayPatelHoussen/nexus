import { api } from './api'
import { useAuthStore } from '@/stores/authStore'
import type { User } from '@/types'

interface LoginResponse {
  accessToken:  string
  refreshToken: string
  user:         User
}

export const authService = {
  async login(username: string, password: string): Promise<LoginResponse> {
    const { data } = await api.post<{ success: boolean; data: LoginResponse }>(
      '/auth/login',
      { username, password },
    )
    return data.data
  },

  async logout(refreshToken: string): Promise<void> {
    await api.post('/auth/logout', { refreshToken })
  },

  async me(): Promise<User> {
    const { data } = await api.get<{ success: boolean; data: User }>('/auth/me')
    return data.data
  },

  async changeUsername(username: string, currentPassword: string): Promise<{ user: User; accessToken: string }> {
    const { data } = await api.patch<{ success: boolean; data: { user: User; accessToken: string } }>(
      '/auth/username', { username, currentPassword })
    return data.data
  },

  /** The other devices are signed out; this one gets new tokens (stored here) and stays signed in. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const { data } = await api.patch<{ data?: { accessToken?: string; refreshToken?: string } }>(
      '/auth/password', { currentPassword, newPassword })
    if (data.data?.refreshToken) localStorage.setItem('nexus_refresh_token', data.data.refreshToken)
    if (data.data?.accessToken) useAuthStore.getState().setAccessToken(data.data.accessToken)
  },
}
