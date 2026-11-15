import { api } from './api'

/** Réglages › Utilisateurs, Appareils connectés, Journal des connexions (admins). */

export interface Account {
  id:        string
  username:  string
  email:     string
  role:      'admin' | 'user'
  createdAt: string
  lastLogin: string | null
  /** End of an account opened for a limited time (null: no limit) */
  expiresAt: string | null
  expired:   boolean
  /** Devices signed in right now */
  devices:   number
}

export interface DeviceSession {
  id:           string
  userId:       string
  username:     string
  role:         'admin' | 'user'
  /** « iPhone · Safari » */
  device:       string
  /** « Lyon, Auvergne-Rhône-Alpes, France », « Réseau local », or null */
  location:     string | null
  ip:           string | null
  signedInAt:   string
  lastActiveAt: string
  /** The device asking */
  current:      boolean
}

export interface SignInEvent {
  id:        string
  userId:    string | null
  username:  string
  success:   boolean
  reason:    'ok' | 'password' | 'unknown' | 'expired'
  newDevice: boolean
  device:    string
  location:  string | null
  ip:        string | null
  at:        string
}

export interface NewAccount {
  username:  string
  email:     string
  password:  string
  expiresAt: string | null
}

export const usersService = {
  list: async () => (await api.get<{ data: Account[] }>('/users')).data.data,
  create: async (body: NewAccount) => (await api.post<{ data: { id: string } }>('/users', body)).data.data,
  setExpiry: async (id: string, expiresAt: string | null) => { await api.patch(`/users/${id}`, { expiresAt }) },
  remove: async (id: string) => { await api.delete(`/users/${id}`) },
  signOutEverywhere: async (id: string) => (await api.post<{ data: { removed: number } }>(`/users/${id}/sign-out`)).data.data,
  sessions: async () => (await api.get<{ data: DeviceSession[] }>('/users/sessions')).data.data,
  revokeSession: async (id: string) => { await api.delete(`/users/sessions/${id}`) },
  logins: async (params: { limit?: number; user?: string } = {}) =>
    (await api.get<{ data: SignInEvent[] }>('/users/logins', { params })).data.data,
  /** Removes one entry of the journal */
  deleteLogin: async (id: string) => { await api.delete(`/users/logins/${id}`) },
  /** Clears the journal (one account's entries with `user`) */
  clearLogins: async (user?: string) =>
    (await api.delete<{ data: { removed: number } }>('/users/logins', { params: user ? { user } : {} })).data.data,
}

/** « Mot de passe incorrect », « Nom inconnu »… for a refused sign-in. */
export const SIGN_IN_REASON: Record<SignInEvent['reason'], string> = {
  ok: 'Connecté',
  password: 'Mot de passe incorrect',
  unknown: 'Nom inconnu',
  expired: 'Compte expiré',
}

/** Account durations offered when creating or extending one (« Autre » : a date of your choice). */
export const DURATIONS = [
  { value: 'none', label: 'Illimité', months: 0 },
  { value: '1m', label: '1 mois', months: 1 },
  { value: '6m', label: '6 mois', months: 6 },
  { value: '1y', label: '1 an', months: 12 },
] as const
export type Duration = typeof DURATIONS[number]['value']

const pad = (n: number) => String(n).padStart(2, '0')
/** « 2026-11-16 »: a local day, as a date field takes it. */
export const dayValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** The first day a chosen end date may be: tomorrow. */
export const firstEndDay = (now = new Date()) => dayValue(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
/** A chosen end day → its end (23:59:59, local time) as ISO; null when empty or not after today. */
export function endOfDay(day: string, now = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < firstEndDay(now)) return null
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59).toISOString()
}

/** The end date of a duration starting now (or from `from`), as ISO; null for no limit. */
export function endOf(duration: Duration, from = new Date()): string | null {
  const months = DURATIONS.find((d) => d.value === duration)?.months ?? 0
  if (!months) return null
  const end = new Date(from)
  end.setMonth(end.getMonth() + months)
  return end.toISOString()
}
