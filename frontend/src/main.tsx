import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'framer-motion'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'
import AppToaster from '@/components/ui/AppToaster'
import App from './App'
import { useAuthStore } from '@/stores/authStore'
import { registerServiceWorker } from '@/services/pushService'
import { installNativeFeel } from '@/services/nativeFeel'
import './index.css'

// Push notifications (PWA): the service worker only handles notifications
void registerServiceWorker()
// Touch screens: a long press never opens the browser's menus (feels like an installed app)
installNativeFeel()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

// Signed out: nothing of that account stays in memory for the next one (its queue, its lists)
useAuthStore.subscribe((state, prev) => { if (prev.isAuth && !state.isAuth) queryClient.clear() })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Springs everywhere, none when the system asks for reduced motion */}
      <MotionConfig reducedMotion="user">
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
        <AppToaster />
      </MotionConfig>
    </QueryClientProvider>
  </React.StrictMode>,
)
