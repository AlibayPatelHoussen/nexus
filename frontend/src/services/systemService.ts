import { api } from './api'
import type { SystemStats, ServiceInfo } from '@/types'

export const systemService = {
  async getStats(): Promise<SystemStats> {
    const { data } = await api.get<{ success: boolean; data: SystemStats }>('/system/stats')
    return data.data
  },

  async getLogs(lines = 100): Promise<string[]> {
    const { data } = await api.get<{ success: boolean; data: string[] }>(
      `/system/logs?lines=${lines}`,
    )
    return data.data
  },
}

export const servicesService = {
  async getAll(): Promise<ServiceInfo[]> {
    const { data } = await api.get<{ success: boolean; data: ServiceInfo[] }>('/services')
    return data.data
  },

  async toggle(name: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
    await api.post(`/services/${name}/toggle`, { action })
  },

  async getLogs(name: string, lines = 50): Promise<string[]> {
    const { data } = await api.get<{ success: boolean; data: string[] }>(
      `/services/${name}/logs?lines=${lines}`,
    )
    return data.data
  },
}
