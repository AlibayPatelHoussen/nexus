import { useNavigate } from 'react-router-dom'
import { Home, ArrowLeft } from 'lucide-react'

export default function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'var(--bg)' }}
    >
      <div className="text-center animate-fade-up">
        {/* Big 404 */}
        <div
          className="text-[120px] font-bold leading-none mb-4 select-none"
          style={{
            background:         'linear-gradient(135deg, var(--blue), var(--purple))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip:     'text',
          }}
        >
          404
        </div>

        <h1 className="text-[22px] font-bold mb-2 tracking-tight" style={{ color: 'var(--text)' }}>
          Page introuvable
        </h1>
        <p className="text-[13.5px] mb-8 max-w-xs mx-auto" style={{ color: 'var(--text3)' }}>
          La page que vous cherchez n'existe pas ou a été déplacée.
        </p>

        <div className="flex items-center justify-center gap-3">
          <button
            className="btn-ghost text-[13px]"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft size={14} strokeWidth={2} />
            Retour
          </button>
          <button
            className="btn-primary text-[13px]"
            onClick={() => navigate('/dashboard')}
          >
            <Home size={14} strokeWidth={2} />
            Dashboard
          </button>
        </div>
      </div>
    </div>
  )
}
