import { api } from './api'

/** PWA notifications: availability on this device, subscribe / unsubscribe. */
export type PushSupport = 'ok' | 'needs-home-screen' | 'unsupported' | 'insecure'

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return 'insecure'
  if (isIOS() && !standalone()) return 'needs-home-screen'   // Safari: only from the home screen app
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return 'ok'
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null
  try { return await navigator.serviceWorker.register('/sw.js') } catch { return null }
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker?.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

/** Asks the permission (must follow a tap) and registers this device. */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('denied')
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker())
  if (!reg) throw new Error('no-sw')
  await navigator.serviceWorker.ready
  const { data } = await api.get<{ data: { publicKey: string } }>('/push/key')
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(data.data.publicKey) })
  await api.post('/push/subscribe', { subscription: sub.toJSON() })
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {})
  await sub.unsubscribe()
}

export const testPush = async () =>
  (await api.post<{ data: { devices: number; sent: number; errors: string[] } }>('/push/test')).data.data

/** The server may have forgotten this device (reinstall, cleanup): send it again. */
export async function resyncPush(): Promise<boolean> {
  const sub = await currentSubscription()
  if (!sub || Notification.permission !== 'granted') return false
  await api.post('/push/subscribe', { subscription: sub.toJSON() }).catch(() => {})
  return true
}
