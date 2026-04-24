import { useState } from 'react'
import { Sun, Moon, Lock, User, Save, ScanLine, Trash2 } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { authService } from '@/services/authService'
import { mediaService } from '@/services/mediaService'
import toast from 'react-hot-toast'

export default function SettingsPage() {
  const user     = useAuthStore((s) => s.user)
  const theme    = useAuthStore((s) => s.theme)
  const setTheme = useAuthStore((s) => s.setTheme)

  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd,     setNewPwd]     = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [scanning,   setScanning]   = useState(false)
  const [pruning,    setPruning]    = useState(false)

  async function handleScan() {
    setScanning(true)
    try {
      await mediaService.scan()
      toast.success('Scan lancé en arrière-plan')
    } catch { toast.error('Erreur lors du scan') }
    finally { setScanning(false) }
  }

  async function handlePrune() {
    setPruning(true)
    try {
      const removed = await mediaService.prune()
      if (removed === 0) toast.success('Aucun fichier manquant détecté')
      else toast.success(`${removed} entrée(s) supprimée(s) de la base`)
    } catch { toast.error('Erreur lors du nettoyage') }
    finally { setPruning(false) }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    if (newPwd !== confirmPwd) { toast.error('Les mots de passe ne correspondent pas'); return }
    if (newPwd.length < 8)     { toast.error('Minimum 8 caractères'); return }
    setSaving(true)
    try {
      await authService.changePassword(currentPwd, newPwd)
      toast.success('Mot de passe mis à jour')
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
    } catch { toast.error('Mot de passe actuel incorrect') }
    finally { setSaving(false) }
  }

  return (
    <div className="min-h-full" style={{ background: 'var(--bg)' }}>
      <div className="sticky top-0 z-40 px-7 pt-6 pb-1" style={{ background: 'var(--bg)' }}>
        <h1 className="text-[26px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>Paramètres</h1>
        <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text3)' }}>Préférences et sécurité</p>
      </div>

      <div className="px-7 py-5 flex flex-col gap-4 max-w-2xl">

        {/* Profile */}
        <div className="card p-5 animate-fade-up">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--blue-dim)' }}>
              <User size={15} strokeWidth={2} style={{ color: 'var(--blue)' }} />
            </div>
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Profil</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Identifiant', value: user?.username },
              { label: 'Email',       value: user?.email    },
              { label: 'Rôle',        value: user?.role     },
              { label: 'ID',          value: user?.id?.slice(0, 8) + '…' },
            ].map((item) => (
              <div key={item.label}>
                <div className="text-[10.5px] mb-1" style={{ color: 'var(--text3)' }}>{item.label}</div>
                <div className="text-[13px] font-semibold font-mono" style={{ color: 'var(--text)' }}>
                  {item.value || '—'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Theme */}
        <div className="card p-5 animate-fade-up" style={{ animationDelay: '60ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--yellow-dim)' }}>
              {theme === 'dark'
                ? <Moon size={15} strokeWidth={2} style={{ color: 'var(--yellow)' }} />
                : <Sun  size={15} strokeWidth={2} style={{ color: 'var(--yellow)' }} />
              }
            </div>
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Apparence</h2>
          </div>
          <div className="flex gap-3">
            {(['dark', 'light'] as const).map((t) => (
              <button
                key={t}
                className="flex-1 flex items-center gap-3 p-3 rounded-xl border-2 transition-all"
                style={{
                  background:   theme === t ? 'var(--blue-dim)' : 'var(--surface2)',
                  borderColor:  theme === t ? 'var(--blue)'     : 'var(--border)',
                }}
                onClick={() => setTheme(t)}
              >
                {t === 'dark'
                  ? <Moon size={16} strokeWidth={2} style={{ color: theme === t ? 'var(--blue)' : 'var(--text3)' }} />
                  : <Sun  size={16} strokeWidth={2} style={{ color: theme === t ? 'var(--blue)' : 'var(--text3)' }} />
                }
                <div>
                  <div className="text-[13px] font-semibold" style={{ color: theme === t ? 'var(--blue)' : 'var(--text)' }}>
                    {t === 'dark' ? 'Sombre' : 'Clair'}
                  </div>
                  <div className="text-[10.5px]" style={{ color: 'var(--text3)' }}>
                    {t === 'dark' ? 'Mode nuit' : 'Mode jour'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Bibliothèque */}
        {user?.role === 'admin' && (
          <div className="card p-5 animate-fade-up" style={{ animationDelay: '120ms' }}>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--blue-dim)' }}>
                <ScanLine size={15} strokeWidth={2} style={{ color: 'var(--blue)' }} />
              </div>
              <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Bibliothèque</h2>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'var(--surface2)' }}>
                <ScanLine size={15} strokeWidth={2} style={{ color: 'var(--text3)', marginTop: 2 }} />
                <div className="flex-1">
                  <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Scanner les médias</div>
                  <div className="text-[11px]" style={{ color: 'var(--text3)' }}>
                    Ajoute les nouveaux fichiers détectés dans les dossiers configurés
                  </div>
                </div>
                <button className="btn-primary text-[12px]" onClick={handleScan} disabled={scanning}>
                  {scanning ? 'Scan…' : 'Scanner'}
                </button>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'var(--surface2)' }}>
                <Trash2 size={15} strokeWidth={2} style={{ color: 'var(--red)', marginTop: 2 }} />
                <div className="flex-1">
                  <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Nettoyer la bibliothèque</div>
                  <div className="text-[11px]" style={{ color: 'var(--text3)' }}>
                    Supprime de la base les films, séries, animes et mangas dont le fichier n'existe plus
                  </div>
                </div>
                <button
                  className="btn-ghost text-[12px]"
                  style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                  onClick={handlePrune}
                  disabled={pruning}
                >
                  {pruning ? 'Nettoyage…' : 'Nettoyer'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Password */}
        <div className="card p-5 animate-fade-up" style={{ animationDelay: '180ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--red-dim)' }}>
              <Lock size={15} strokeWidth={2} style={{ color: 'var(--red)' }} />
            </div>
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Mot de passe</h2>
          </div>
          <form onSubmit={handlePasswordChange} className="flex flex-col gap-3">
            {[
              { label: 'Mot de passe actuel', value: currentPwd, set: setCurrentPwd, auto: 'current-password' },
              { label: 'Nouveau mot de passe', value: newPwd, set: setNewPwd, auto: 'new-password' },
              { label: 'Confirmer',            value: confirmPwd, set: setConfirmPwd, auto: 'new-password' },
            ].map((f) => (
              <div key={f.label}>
                <label className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--text3)' }}>
                  {f.label.toUpperCase()}
                </label>
                <input
                  className="input"
                  type="password"
                  autoComplete={f.auto}
                  value={f.value}
                  onChange={(e) => f.set(e.target.value)}
                  required
                />
              </div>
            ))}
            <button type="submit" className="btn-primary self-start mt-1" disabled={saving}>
              <Save size={13} strokeWidth={2} />
              {saving ? 'Sauvegarde…' : 'Mettre à jour'}
            </button>
          </form>
        </div>

      </div>
    </div>
  )
}
