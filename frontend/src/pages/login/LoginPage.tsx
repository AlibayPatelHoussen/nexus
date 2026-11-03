import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { authService } from '@/services/authService'
import Button from '@/components/ui/Button'

/** Sign-in, in the spirit of the Apple ID screen: centred, quiet, one clear action. */
export default function LoginPage() {
  const navigate = useNavigate()
  const setAuth  = useAuthStore((s) => s.setAuth)
  const setTheme = useAuthStore((s) => s.setTheme)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const passRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!username || !password) return
    setLoading(true)
    setError(null)
    try {
      const result = await authService.login(username, password)
      localStorage.setItem('nexus_refresh_token', result.refreshToken)
      setAuth(result.user, result.accessToken)
      setTheme(result.user.theme)
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      const e2 = err as { response?: { status?: number; data?: { error?: string } } }
      setError(
        e2.response?.status === 401 ? 'Identifiant ou mot de passe incorrect.'
          : e2.response?.data?.error || 'Le serveur ne répond pas. Vérifie qu’il est démarré, puis réessaie.',
      )
      setPassword('')
      passRef.current?.focus()
    } finally {
      setLoading(false)
    }
  }

  const field = 'w-full bg-transparent outline-none text-label placeholder:text-label3 px-4 min-h-[44px] text-[17px] md:text-[15px]'

  return (
    <main className="min-h-[100dvh] grid place-items-center bg-bg px-4 safe-x" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="w-full max-w-[340px] flex flex-col items-center" style={{ animation: 'nx-fade-in 250ms var(--ease-out) both' }}>
        <img src="/icons/icon-192.png" alt="" width={72} height={72} className="rounded-[16px] mb-5" />
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-label text-center">Se connecter à Nexus</h1>
        <p className="text-subhead text-label2 mt-1 mb-7">{window.location.hostname}</p>

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4" noValidate>
          <div
            className="bg-surface rounded-[12px] overflow-hidden focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_35%,transparent)] transition-shadow duration-fast"
            style={{ boxShadow: error ? '0 0 0 1px var(--red)' : undefined }}
          >
            <label className="sr-only" htmlFor="login-username">Identifiant</label>
            <input
              id="login-username"
              className={field}
              type="text"
              placeholder="Identifiant ou e-mail"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(null) }}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              required
            />
            <div className="relative hairline-t">
              <label className="sr-only" htmlFor="login-password">Mot de passe</label>
              <input
                ref={passRef}
                id="login-password"
                className={`${field} pr-12`}
                type={showPass ? 'text' : 'password'}
                placeholder="Mot de passe"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null) }}
                autoComplete="current-password"
                required
                aria-invalid={!!error || undefined}
                aria-describedby={error ? 'login-error' : undefined}
              />
              <button
                type="button"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 grid place-items-center rounded-[8px] text-label2 hoverable"
                onClick={() => setShowPass((s) => !s)}
                aria-label={showPass ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                aria-pressed={showPass}
              >
                {showPass ? <EyeOff size={18} strokeWidth={1.5} /> : <Eye size={18} strokeWidth={1.5} />}
              </button>
            </div>
          </div>

          {error && <p id="login-error" role="alert" className="text-subhead text-danger-text text-center -mt-1">{error}</p>}

          <Button type="submit" variant="primary" size="large" loading={loading} disabled={!username || !password} className="md:min-h-[40px] md:text-[15px]">
            {loading ? 'Connexion…' : 'Se connecter'}
          </Button>
        </form>
      </div>
    </main>
  )
}
