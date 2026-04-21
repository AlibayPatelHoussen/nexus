import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layers, Eye, EyeOff, Loader } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { authService } from '@/services/authService'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const navigate  = useNavigate()
  const setAuth   = useAuthStore((s) => s.setAuth)
  const setTheme  = useAuthStore((s) => s.setTheme)

  const [username,   setUsername]   = useState('')
  const [password,   setPassword]   = useState('')
  const [showPass,   setShowPass]   = useState(false)
  const [loading,    setLoading]    = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!username || !password) return

    setLoading(true)
    try {
      const result = await authService.login(username, password)
      localStorage.setItem('nexus_refresh_token', result.refreshToken)
      setAuth(result.user, result.accessToken)
      setTheme(result.user.theme)
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error || 'Identifiants incorrects'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--bg)' }}
    >
      {/* Background grid */}
      <div
        className="fixed inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative w-full max-w-sm animate-fade-up">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'var(--blue)', boxShadow: '0 0 24px var(--blue-dim)' }}
          >
            <Layers size={22} color="white" strokeWidth={2.5} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Nexus
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text3)' }}>
            Connectez-vous à votre serveur
          </p>
        </div>

        {/* Form */}
        <div
          className="card p-6"
          style={{ boxShadow: 'var(--shadow-lg)' }}
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold" style={{ color: 'var(--text3)' }}>
                IDENTIFIANT
              </label>
              <input
                className="input"
                type="text"
                placeholder="username ou email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold" style={{ color: 'var(--text3)' }}>
                MOT DE PASSE
              </label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showPass ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text3)' }}
                  onClick={() => setShowPass(!showPass)}
                >
                  {showPass
                    ? <EyeOff size={15} strokeWidth={2} />
                    : <Eye     size={15} strokeWidth={2} />
                  }
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn-primary justify-center mt-2"
              disabled={loading}
              style={{ opacity: loading ? 0.7 : 1 }}
            >
              {loading
                ? <><Loader size={14} className="animate-spin" /> Connexion...</>
                : 'Se connecter'
              }
            </button>
          </form>
        </div>

        <p className="text-center text-xs mt-4" style={{ color: 'var(--text3)' }}>
          houssen-serveur.com
        </p>
      </div>
    </div>
  )
}
