import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'
import AppToaster from '@/components/ui/AppToaster'
import App from './App'
import { registerServiceWorker } from '@/services/pushService'
import './index.css'

// Push notifications (PWA): the service worker only handles notifications
void registerServiceWorker()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
      <AppToaster />
    </QueryClientProvider>
  </React.StrictMode>,
)
