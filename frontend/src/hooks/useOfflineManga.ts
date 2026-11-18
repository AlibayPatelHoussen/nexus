import { useSyncExternalStore } from 'react'
import { getState, subscribe } from '@/services/offlineManga'

/** The device's offline mangas (switch, kept chapters, download in progress), live. */
export function useOfflineManga() {
  return useSyncExternalStore(subscribe, getState, getState)
}
