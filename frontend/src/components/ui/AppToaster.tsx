import { Toaster } from 'react-hot-toast'
import { useDevice } from '@/hooks/useDevice'

/** Notifications: banners at the top right (macOS) or top centre (iOS). */
export default function AppToaster() {
  const phone = useDevice() === 'phone'
  return (
    <Toaster
      position={phone ? 'top-center' : 'top-right'}
      containerStyle={{ top: phone ? 'calc(env(safe-area-inset-top, 0px) + 8px)' : 12, right: 12 }}
      gutter={8}
      toastOptions={{
        duration: 3000,
        className: 'material-bar',
        style: {
          color: 'var(--label)',
          borderRadius: 12,
          fontSize: 'var(--text-body)',
          fontFamily: 'var(--font)',
          padding: '10px 14px',
          maxWidth: 380,
          boxShadow: 'var(--shadow-popover)',
        },
        success: { iconTheme: { primary: 'var(--green)', secondary: '#fff' } },
        error:   { iconTheme: { primary: 'var(--red)', secondary: '#fff' }, duration: 6000 },
      }}
    />
  )
}
