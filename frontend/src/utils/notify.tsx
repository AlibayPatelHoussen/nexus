import toast from 'react-hot-toast'
import { CheckCircle2, XCircle, AlertCircle, Info } from 'lucide-react'

// Custom toast wrappers with Nexus styling
export const notify = {
  success: (message: string, title?: string) =>
    toast.custom((t) => (
      <div
        className={`flex items-start gap-3 px-4 py-3 rounded-xl border transition-all duration-300 ${
          t.visible ? 'animate-fade-up' : 'opacity-0'
        }`}
        style={{
          background:  'var(--surface)',
          border:      '1px solid var(--green-dim)',
          boxShadow:   'var(--shadow-lg)',
          minWidth:    '260px',
          maxWidth:    '360px',
        }}
      >
        <CheckCircle2 size={16} strokeWidth={2} style={{ color: 'var(--green)', flexShrink: 0, marginTop: '1px' }} />
        <div className="flex-1 min-w-0">
          {title && (
            <p className="text-[13px] font-semibold mb-0.5" style={{ color: 'var(--text)' }}>{title}</p>
          )}
          <p className="text-[12.5px]" style={{ color: title ? 'var(--text2)' : 'var(--text)' }}>{message}</p>
        </div>
      </div>
    ), { duration: 3000 }),

  error: (message: string, title?: string) =>
    toast.custom((t) => (
      <div
        className={`flex items-start gap-3 px-4 py-3 rounded-xl border transition-all duration-300 ${
          t.visible ? 'animate-fade-up' : 'opacity-0'
        }`}
        style={{
          background: 'var(--surface)',
          border:     '1px solid var(--red-dim)',
          boxShadow:  'var(--shadow-lg)',
          minWidth:   '260px',
          maxWidth:   '360px',
        }}
      >
        <XCircle size={16} strokeWidth={2} style={{ color: 'var(--red)', flexShrink: 0, marginTop: '1px' }} />
        <div className="flex-1 min-w-0">
          {title && (
            <p className="text-[13px] font-semibold mb-0.5" style={{ color: 'var(--text)' }}>{title}</p>
          )}
          <p className="text-[12.5px]" style={{ color: title ? 'var(--text2)' : 'var(--text)' }}>{message}</p>
        </div>
      </div>
    ), { duration: 4000 }),

  warning: (message: string, title?: string) =>
    toast.custom((t) => (
      <div
        className={`flex items-start gap-3 px-4 py-3 rounded-xl border transition-all duration-300 ${
          t.visible ? 'animate-fade-up' : 'opacity-0'
        }`}
        style={{
          background: 'var(--surface)',
          border:     '1px solid var(--orange-dim)',
          boxShadow:  'var(--shadow-lg)',
          minWidth:   '260px',
          maxWidth:   '360px',
        }}
      >
        <AlertCircle size={16} strokeWidth={2} style={{ color: 'var(--orange)', flexShrink: 0, marginTop: '1px' }} />
        <div className="flex-1 min-w-0">
          {title && (
            <p className="text-[13px] font-semibold mb-0.5" style={{ color: 'var(--text)' }}>{title}</p>
          )}
          <p className="text-[12.5px]" style={{ color: title ? 'var(--text2)' : 'var(--text)' }}>{message}</p>
        </div>
      </div>
    ), { duration: 4000 }),

  info: (message: string, title?: string) =>
    toast.custom((t) => (
      <div
        className={`flex items-start gap-3 px-4 py-3 rounded-xl border transition-all duration-300 ${
          t.visible ? 'animate-fade-up' : 'opacity-0'
        }`}
        style={{
          background: 'var(--surface)',
          border:     '1px solid var(--blue-dim)',
          boxShadow:  'var(--shadow-lg)',
          minWidth:   '260px',
          maxWidth:   '360px',
        }}
      >
        <Info size={16} strokeWidth={2} style={{ color: 'var(--blue)', flexShrink: 0, marginTop: '1px' }} />
        <div className="flex-1 min-w-0">
          {title && (
            <p className="text-[13px] font-semibold mb-0.5" style={{ color: 'var(--text)' }}>{title}</p>
          )}
          <p className="text-[12.5px]" style={{ color: title ? 'var(--text2)' : 'var(--text)' }}>{message}</p>
        </div>
      </div>
    ), { duration: 3000 }),

  loading: (message: string) => toast.loading(message),

  dismiss: (id?: string) => id ? toast.dismiss(id) : toast.dismiss(),
}
