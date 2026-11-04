import { Toaster } from 'react-hot-toast'
import { useDevice } from '@/hooks/useDevice'

/** Notifications: bottom right on desktop (never over the toolbar or the first rows), top centre on iOS. */
export default function AppToaster() {
  const phone = useDevice() === 'phone'
  return (
    <Toaster
      position={phone ? 'top-center' : 'bottom-right'}
      containerStyle={phone ? { top: 'calc(env(safe-area-inset-top, 0px) + 8px)' } : { bottom: 16, right: 16 }}
      gutter={8}
      toastOptions={{
        duration: 3000,
        style: {
          // Inline: react-hot-toast sets a white background inline otherwise
          // Liquid Glass capsule (iOS 26 notifications / HUDs)
          background: 'var(--glass-fill-strong)',
          backdropFilter: 'var(--glass-filter-strong)',
          WebkitBackdropFilter: 'var(--glass-filter-strong)',
          color: 'var(--label)',
          borderRadius: 999,
          fontSize: 'var(--text-body)',
          fontFamily: 'var(--font)',
          padding: '10px 18px',
          maxWidth: 380,
          boxShadow: 'var(--glass-rim-strong), var(--glass-shadow-strong)',
        },
        success: { iconTheme: { primary: 'var(--green)', secondary: '#fff' } },
        error:   { iconTheme: { primary: 'var(--red)', secondary: '#fff' }, duration: 6000 },
      }}
    />
  )
}
