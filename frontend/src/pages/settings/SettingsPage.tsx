import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FRONTEND_COMMIT, getServerHealth, isBackendOutdated } from '@/services/versionService'
import { useAuthStore } from '@/stores/authStore'
import { authService } from '@/services/authService'
import { mediaService } from '@/services/mediaService'
import Page from '@/components/shell/Page'
import { useShell } from '@/components/shell/shellContext'
import { Group, ListRow } from '@/components/ui/GroupedList'
import SegmentedControl from '@/components/ui/SegmentedControl'
import Button from '@/components/ui/Button'
import { useConfirm } from '@/components/ui/useConfirm'
import type { Appearance } from '@/types'
import NotificationsGroup from './NotificationsGroup'

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user)
  const appearance = useAuthStore((s) => s.appearance)
  const setAppearance = useAuthStore((s) => s.setAppearance)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { device } = useShell()
  const phone = device === 'phone'
  const [scanning, setScanning] = useState(false)
  const [pruning, setPruning] = useState(false)

  async function handleScan() {
    setScanning(true)
    try {
      await mediaService.scan()
      toast.success('Analyse lancée : les nouveaux titres apparaissent dans quelques instants.')
    } catch { toast.error('L’analyse n’a pas pu démarrer.') }
    finally { setScanning(false) }
  }

  async function handlePrune() {
    const ok = await confirm({
      title: 'Nettoyer la bibliothèque ?',
      message: 'Les films, séries, animes et mangas dont le fichier n’existe plus sur le disque sont retirés de Nexus. Les fichiers ne sont pas touchés.',
      confirmLabel: 'Nettoyer',
      danger: true,
    })
    if (!ok) return
    setPruning(true)
    try {
      const removed = await mediaService.prune()
      toast.success(removed === 0 ? 'Aucun fichier manquant : rien à retirer.' : `${removed} titre${removed > 1 ? 's' : ''} retiré${removed > 1 ? 's' : ''} de la bibliothèque.`)
    } catch { toast.error('Le nettoyage a échoué.') }
    finally { setPruning(false) }
  }

  async function handleLogout() {
    const ok = await confirm({ title: 'Se déconnecter ?', message: 'Tu devras saisir à nouveau ton mot de passe sur cet appareil.', confirmLabel: 'Se déconnecter', danger: true })
    if (!ok) return
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <Page title="Réglages" narrow>
      <div className="flex flex-col gap-8 max-w-[680px] mx-auto">
        {/* Account */}
        <Group>
          <div role="listitem" className="nx-row relative flex items-center gap-3.5 px-4 py-3">
            <span className="w-12 h-12 rounded-full bg-fill grid place-items-center text-[20px] font-semibold text-label2 flex-shrink-0" aria-hidden="true">
              {user?.username?.[0]?.toUpperCase() ?? '?'}
            </span>
            <span className="min-w-0">
              <span className="block text-headline text-label truncate">{user?.username}</span>
              <span className="block text-subhead text-label2 truncate">{user?.email} · {user?.role === 'admin' ? 'Administrateur' : 'Utilisateur'}</span>
            </span>
          </div>
        </Group>

        <Group header="Apparence" footer="Auto suit le réglage clair ou sombre de l’appareil. Ce choix est propre à cet appareil.">
          <div role="listitem" className="nx-row relative flex items-center justify-between gap-3 px-4 min-h-row py-2">
            {!phone && <span className="text-label">Apparence</span>}
            <SegmentedControl<Appearance>
              label="Apparence"
              value={appearance}
              onChange={setAppearance}
              full={phone}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'light', label: 'Clair' },
                { value: 'dark', label: 'Sombre' },
              ]}
            />
          </div>
        </Group>

        {user?.role === 'admin' && (
          <Group header="Bibliothèque">
            <ListRow wrap title="Analyser les médias" subtitle="Ajoute les fichiers trouvés dans les dossiers de la bibliothèque.">
              <Button size="small" loading={scanning} onClick={handleScan}>Analyser</Button>
            </ListRow>
            <ListRow wrap title="Nettoyer la bibliothèque" subtitle="Retire les titres dont le fichier n’existe plus.">
              <Button size="small" variant="destructive" loading={pruning} onClick={handlePrune}>Nettoyer…</Button>
            </ListRow>
          </Group>
        )}

        {user?.role === 'admin' && <NotificationsGroup />}
        <UsernameGroup />
        <PasswordGroup />
        <VersionGroup />

        <Group>
          <ListRow title="Se déconnecter" destructive onClick={handleLogout} className="justify-center [&>span]:text-center" />
        </Group>
      </div>
    </Page>
  )
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,50}$/

function UsernameGroup() {
  const user = useAuthStore((s) => s.user)
  const setAuth = useAuthStore((s) => s.setAuth)
  const [name, setName] = useState(user?.username ?? '')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = name.trim()
  const changed = !!trimmed && trimmed !== user?.username

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!USERNAME_RE.test(trimmed)) { setError('3 à 50 caractères : lettres, chiffres, _ et - (sans espace ni accent).'); return }
    setSaving(true); setError(null)
    try {
      const res = await authService.changeUsername(trimmed, password)
      setAuth(res.user, res.accessToken)
      toast.success('Nom d’utilisateur modifié')
      setName(res.user.username); setPassword('')
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      setError(status === 409 ? 'Ce nom d’utilisateur est déjà pris.'
        : status === 401 ? 'Le mot de passe est incorrect.'
        : status === 422 ? '3 à 50 caractères : lettres, chiffres, _ et - (sans espace ni accent).'
        : 'Impossible de modifier le nom d’utilisateur.')
    } finally { setSaving(false) }
  }

  const row = 'nx-row relative flex items-center gap-3 px-4 min-h-row'
  const input = 'flex-1 min-w-0 bg-transparent outline-none text-label placeholder:text-label3 py-2'
  const described = error ? 'username-error' : undefined
  return (
    <form onSubmit={submit} aria-labelledby="username-h">
      <Group id="username" header="Nom d’utilisateur" footer="Sert à te connecter. Ton mot de passe est demandé pour le changer.">
        <div role="listitem" className={row}>
          <label htmlFor="user-name" className="w-[120px] max-md:w-[110px] flex-shrink-0 text-label">Nom</label>
          <input
            id="user-name" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            value={name} onChange={(e) => { setName(e.target.value); setError(null) }} required maxLength={50}
            className={input} aria-invalid={!!error || undefined} aria-describedby={described}
          />
        </div>
        {changed && (
          <div role="listitem" className={row}>
            <label htmlFor="user-pwd" className="w-[120px] max-md:w-[110px] flex-shrink-0 text-label">Mot de passe</label>
            <input
              id="user-pwd" type="password" autoComplete="current-password"
              value={password} onChange={(e) => { setPassword(e.target.value); setError(null) }} required
              className={input} placeholder="Requis" aria-invalid={!!error || undefined} aria-describedby={described}
            />
          </div>
        )}
      </Group>
      {error && <p id="username-error" role="alert" className="text-subhead text-danger-text px-4 pt-2">{error}</p>}
      {changed && (
        <div className="flex justify-end px-1 pt-3">
          <Button type="submit" variant="primary" loading={saving} disabled={!password} className="max-md:w-full max-md:min-h-[44px]">
            Modifier le nom d’utilisateur
          </Button>
        </div>
      )}
    </form>
  )
}

function PasswordGroup() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (next.length < 8) { setError('Le nouveau mot de passe doit faire au moins 8 caractères.'); return }
    if (next !== again) { setError('Les deux nouveaux mots de passe ne sont pas identiques.'); return }
    setSaving(true); setError(null)
    try {
      await authService.changePassword(current, next)
      toast.success('Mot de passe mis à jour')
      setCurrent(''); setNext(''); setAgain('')
    } catch {
      setError('Le mot de passe actuel est incorrect.')
    } finally { setSaving(false) }
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, auto: string) => (
    <div role="listitem" className="nx-row relative flex items-center gap-3 px-4 min-h-row">
      <label htmlFor={id} className="w-[120px] max-md:w-[110px] flex-shrink-0 text-label">{label}</label>
      <input
        id={id}
        type="password"
        autoComplete={auto}
        value={value}
        onChange={(e) => { set(e.target.value); setError(null) }}
        required
        className="flex-1 min-w-0 bg-transparent outline-none text-label placeholder:text-label3 py-2"
        placeholder="Requis"
        aria-invalid={!!error || undefined}
        aria-describedby={error ? 'password-error' : undefined}
      />
    </div>
  )

  return (
    <form onSubmit={submit} aria-labelledby="password-h">
      <Group id="password" header="Mot de passe">
        {field('pwd-current', 'Actuel', current, setCurrent, 'current-password')}
        {field('pwd-new', 'Nouveau', next, setNext, 'new-password')}
        {field('pwd-again', 'Confirmer', again, setAgain, 'new-password')}
      </Group>
      {error && <p id="password-error" role="alert" className="text-subhead text-danger-text px-4 pt-2">{error}</p>}
      <div className="flex justify-end px-1 pt-3">
        <Button type="submit" variant="primary" loading={saving} disabled={!current || !next || !again} className="max-md:w-full max-md:min-h-[44px]">
          Modifier le mot de passe
        </Button>
      </div>
    </form>
  )
}

function VersionGroup() {
  const { data, isError } = useQuery({ queryKey: ['server-health'], queryFn: getServerHealth, staleTime: 60_000, retry: 1 })
  const outdated = isBackendOutdated(data)
  return (
    <Group
      header="Version"
      footer={outdated ? 'Le serveur n’exécute pas la même version que l’interface. Sur le serveur, lance bash scripts/deploy.sh.' : undefined}
    >
      <ListRow title="Interface" detail={<span className="font-mono">{FRONTEND_COMMIT}</span>} />
      <ListRow
        title="Serveur"
        status={outdated ? 'warn' : undefined}
        detail={<span className="font-mono">{isError ? 'injoignable' : data?.build?.commit ?? (data ? 'ancienne version' : '…')}</span>}
      />
      {data?.startedAt && <ListRow title="Démarré le" detail={new Date(data.startedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })} />}
    </Group>
  )
}
