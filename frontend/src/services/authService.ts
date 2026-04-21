import { api } from './api'
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

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await api.patch('/auth/password', { currentPassword, newPassword })
  },
}
