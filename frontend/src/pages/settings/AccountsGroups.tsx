import { useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { isAxiosError } from 'axios'
import { CheckCircle2, Laptop, Smartphone, Tablet, UserPlus, XCircle, type LucideIcon } from 'lucide-react'
import {
  DURATIONS, SIGN_IN_REASON, endOf, usersService,
  type Account, type DeviceSession, type Duration, type SignInEvent,
} from '@/services/usersService'
import { useAuthStore } from '@/stores/authStore'
import { useShell } from '@/components/shell/shellContext'
import { Group, ListRow } from '@/components/ui/GroupedList'
import Sheet from '@/components/ui/Sheet'
import Button from '@/components/ui/Button'
import TextField from '@/components/ui/TextField'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { SkeletonRows } from '@/components/ui/Skeleton'
import EmptyState from '@/components/ui/EmptyState'
import { useConfirm } from '@/components/ui/useConfirm'
import { formatDay, formatWhen } from '@/utils'

/**
 * Réglages (admins): Utilisateurs (« user » accounts, for a limited time or not), Appareils
 * connectés (every signed-in device, « Déconnecter ») and Journal des connexions.
 */

const errorOf = (err: unknown, fallback: string) =>
  (isAxiosError(err) ? (err.response?.data as { error?: string } | undefined)?.error : undefined) ?? fallback

/** iPhone, iPad or computer, from « iPhone · Safari ». */
function deviceIcon(device: string): LucideIcon {
  if (/^(iPhone|iPod|Android)/.test(device)) return Smartphone
  if (/^iPad/.test(device)) return Tablet
  return Laptop
}

const roleLabel = (a: Pick<Account, 'role'>) => (a.role === 'admin' ? 'Administrateur' : 'Utilisateur')

/** « jusqu’au 15 nov. 2027 », « expiré le 3 mars 2026 », or nothing. */
function expiryLabel(a: Pick<Account, 'expiresAt' | 'expired'>): string | null {
  if (!a.expiresAt) return null
  return a.expired ? `expiré le ${formatDay(a.expiresAt)}` : `jusqu’au ${formatDay(a.expiresAt)}`
}

const placeOf = (s: { location: string | null; ip: string | null }) => s.location ?? s.ip ?? 'Lieu inconnu'

/* ── Utilisateurs ────────────────────────────────────────────────────────── */

export function UsersGroup() {
  const { data: accounts, isError } = useQuery({ queryKey: ['accounts'], queryFn: usersService.list, refetchInterval: 60_000 })
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const open = accounts?.find((a) => a.id === openId) ?? null

  return (
    <>
      <Group
        id="utilisateurs"
        header="Utilisateurs"
        footer={<>Un compte « Utilisateur » a les médias, le manga, ses téléchargements et le stockage. Les comptes administrateur se créent dans le terminal : <code className="font-mono">bash scripts/create-admin.sh</code></>}
      >
        {isError ? (
          <EmptyState className="py-8" title="Comptes indisponibles" message="Le serveur n’a pas répondu. Réessaie dans un instant." />
        ) : !accounts ? <SkeletonRows rows={2} /> : accounts.map((a) => (
          <ListRow
            key={a.id}
            title={a.username}
            subtitle={[roleLabel(a), expiryLabel(a)].filter(Boolean).join(' · ')}
            status={a.expired ? 'error' : undefined}
            detail={a.devices ? `${a.devices} appareil${a.devices > 1 ? 's' : ''}` : 'Aucun appareil'}
            accessory="chevron"
            onClick={() => setOpenId(a.id)}
          />
        ))}
        <ListRow title={<span className="text-accent-text">Ajouter un utilisateur…</span>} icon={<UserPlus strokeWidth={1.75} />} onClick={() => setAdding(true)} />
      </Group>
      <NewUserSheet open={adding} onClose={() => setAdding(false)} />
      <AccountSheet account={open} onClose={() => setOpenId(null)} />
    </>
  )
}

function NewUserSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const phone = useShell().device === 'phone'
  const first = useRef<HTMLInputElement>(null)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [duration, setDuration] = useState<Duration>('1y')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formId = useId()

  const nameOk = /^[A-Za-z0-9_-]{3,50}$/.test(username.trim())
  const passOk = password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)
  const valid = nameOk && /^\S+@\S+\.\S+$/.test(email.trim()) && passOk

  function close() {
    if (saving) return
    onClose()
    setUsername(''); setEmail(''); setPassword(''); setDuration('1y'); setError(null)
  }

  async function submit() {
    if (!valid || saving) return
    setSaving(true); setError(null)
    try {
      await usersService.create({ username: username.trim(), email: email.trim(), password, expiresAt: endOf(duration) })
      await qc.invalidateQueries({ queryKey: ['accounts'] })
      toast.success(`Compte « ${username.trim()} » créé`)
      setSaving(false)
      close()
    } catch (err) {
      const status = isAxiosError(err) ? err.response?.status : undefined
      setError(status === 409 ? 'Ce nom ou cet e-mail est déjà utilisé.' : errorOf(err, 'Impossible de créer le compte.'))
      setSaving(false)
    }
  }

  const create = 'Créer'
  return (
    <Sheet
      open={open}
      onClose={close}
      title="Nouvel utilisateur"
      size="sm"
      dismissible={!saving}
      initialFocus={first}
      phoneHeader={{
        left: <Button variant="plain" onClick={close}>Annuler</Button>,
        right: <Button variant="plain" className="font-semibold" loading={saving} disabled={!valid} type="submit" form={formId}>{create}</Button>,
      }}
      footer={phone ? undefined : <><Button onClick={close}>Annuler</Button><Button variant="primary" loading={saving} disabled={!valid} type="submit" form={formId}>{create}</Button></>}
    >
      <form id={formId} className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <TextField ref={first} label="Nom d’utilisateur" value={username} onChange={(e) => { setUsername(e.target.value); setError(null) }}
          autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={50}
          hint="Sert à se connecter : lettres, chiffres, _ et -"
          error={username && !nameOk ? '3 à 50 caractères : lettres, chiffres, _ et - (sans espace ni accent).' : undefined} />
        <TextField label="E-mail" type="email" inputMode="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(null) }}
          autoComplete="off" autoCapitalize="none" spellCheck={false} />
        <TextField label="Mot de passe" type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(null) }}
          autoComplete="new-password"
          hint="Au moins 8 caractères, avec une majuscule, une minuscule et un chiffre"
          error={password && !passOk ? 'Au moins 8 caractères, avec une majuscule, une minuscule et un chiffre.' : undefined} />
        <div className="flex flex-col gap-1.5">
          <span className="text-subhead text-label2" id={`${formId}-d`}>Durée du compte</span>
          <SegmentedControl<Duration> label="Durée du compte" full value={duration} onChange={setDuration}
            options={DURATIONS.map((d) => ({ value: d.value, label: d.label }))} />
          <p className="text-caption text-label2">
            {duration === 'none' ? 'Le compte reste ouvert jusqu’à ce que tu le supprimes.'
              : `Le compte se ferme le ${formatDay(endOf(duration)!)} ; tu peux le prolonger.`}
          </p>
        </div>
        {error && <p role="alert" className="text-subhead text-danger-text">{error}</p>}
      </form>
    </Sheet>
  )
}

function AccountSheet({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const me = useAuthStore((s) => s.user?.id)
  const [busy, setBusy] = useState(false)
  const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: usersService.sessions, enabled: !!account })
  const { data: journal } = useQuery({
    queryKey: ['logins', account?.id], queryFn: () => usersService.logins({ user: account!.id, limit: 10 }), enabled: !!account,
  })
  // Keeps the last account on screen while the sheet closes
  const [shown, setShown] = useState<Account | null>(account)
  if (account && account !== shown) setShown(account)
  const a = account ?? shown
  if (!a) return <Sheet open={false} onClose={onClose} />
  const devices = (sessions ?? []).filter((s) => s.userId === a.id)
  const isUser = a.role === 'user'

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['accounts'] }), qc.invalidateQueries({ queryKey: ['sessions'] }),
    qc.invalidateQueries({ queryKey: ['logins'] }),
  ])

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true)
    try { await action(); await refresh(); toast.success(done) }
    catch (err) { toast.error(errorOf(err, 'L’action n’a pas abouti.')) }
    finally { setBusy(false) }
  }

  async function extend(duration: Duration) {
    // From its current end when it has not passed yet, else from today
    const from = a!.expiresAt && !a!.expired ? new Date(a!.expiresAt) : new Date()
    const end = endOf(duration, from)
    await run(() => usersService.setExpiry(a!.id, end), end ? `Compte ouvert jusqu’au ${formatDay(end)}` : 'Compte sans limite de durée')
  }

  async function signOutEverywhere() {
    const ok = await confirm({
      title: `Déconnecter tous les appareils de ${a!.username} ?`,
      message: 'Chaque appareil devra se reconnecter avec le mot de passe.',
      confirmLabel: 'Déconnecter', danger: true,
    })
    if (ok) await run(() => usersService.signOutEverywhere(a!.id), 'Tous les appareils ont été déconnectés')
  }

  async function remove() {
    const ok = await confirm({
      title: `Supprimer le compte « ${a!.username} » ?`,
      message: 'Ses appareils sont déconnectés, sa liste et son historique de lecture sont effacés. Les fichiers de la bibliothèque ne sont pas touchés.',
      confirmLabel: 'Supprimer', danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await usersService.remove(a!.id)
      onClose()
      await refresh()
      toast.success(`Compte « ${a!.username} » supprimé`)
    } catch (err) { toast.error(errorOf(err, 'Impossible de supprimer ce compte.')) }
    finally { setBusy(false) }
  }

  return (
    <Sheet open={!!account} onClose={onClose} title={a.username} size="md" dismissible={!busy}
      phoneHeader={{ right: <Button variant="plain" className="font-semibold" onClick={onClose}>OK</Button> }}
      footer={<Button variant="primary" onClick={onClose} className="max-md:hidden">OK</Button>}>
      <div className="flex flex-col gap-6">
        <Group>
          <ListRow title="E-mail" detail={a.email} />
          <ListRow title="Type de compte" detail={roleLabel(a)} />
          <ListRow title="Créé le" detail={formatDay(a.createdAt)} />
          <ListRow title="Dernière connexion" detail={a.lastLogin ? formatWhen(a.lastLogin) : 'Jamais'} />
          {isUser && <ListRow title="Accès" detail={a.expired ? 'Expiré' : a.expiresAt ? `Jusqu’au ${formatDay(a.expiresAt)}` : 'Sans limite'} status={a.expired ? 'error' : undefined} />}
        </Group>

        {isUser && (
          <Group header={a.expired ? 'Rouvrir le compte' : 'Prolonger'} footer="La durée s’ajoute à la date de fin actuelle (à partir d’aujourd’hui si elle est passée).">
            <div role="listitem" className="nx-row relative flex flex-wrap items-center gap-2 px-4 py-3">
              {DURATIONS.filter((d) => d.value !== 'none').map((d) => (
                <Button key={d.value} size="small" disabled={busy} onClick={() => void extend(d.value)}>+ {d.label}</Button>
              ))}
              {a.expiresAt && <Button size="small" variant="plain" disabled={busy} onClick={() => void extend('none')}>Sans limite</Button>}
            </div>
          </Group>
        )}

        <Group header="Appareils connectés">
          {!sessions ? <SkeletonRows rows={1} /> : devices.length === 0
            ? <ListRow title={<span className="text-label2">Aucun appareil connecté</span>} />
            : devices.map((s) => <DeviceRow key={s.id} s={s} withName={false} />)}
        </Group>

        <Group header="Dernières connexions">
          {!journal ? <SkeletonRows rows={2} /> : journal.length === 0
            ? <ListRow title={<span className="text-label2">Aucune connexion</span>} />
            : journal.map((e) => <SignInRow key={e.id} e={e} withName={false} />)}
        </Group>

        <Group>
          {devices.length > 0 && a.id !== me && <ListRow title="Déconnecter tous les appareils" destructive onClick={() => void signOutEverywhere()} disabled={busy} />}
          {isUser && <ListRow title="Supprimer le compte…" destructive onClick={() => void remove()} disabled={busy} />}
          {!isUser && <ListRow title={<span className="text-label2">Un compte administrateur se gère dans le terminal.</span>} />}
        </Group>
      </div>
    </Sheet>
  )
}

/* ── Appareils connectés ─────────────────────────────────────────────────── */

function DeviceRow({ s, withName = true }: { s: DeviceSession; withName?: boolean }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const Icon = deviceIcon(s.device)

  async function revoke() {
    const ok = await confirm({
      title: `Déconnecter ${withName ? `${s.username} sur ` : ''}${s.device} ?`,
      message: 'Cet appareil devra se reconnecter avec le mot de passe. Ses notifications s’arrêtent.',
      confirmLabel: 'Déconnecter', danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await usersService.revokeSession(s.id)
      await Promise.all([qc.invalidateQueries({ queryKey: ['sessions'] }), qc.invalidateQueries({ queryKey: ['accounts'] })])
      toast.success('Appareil déconnecté')
    } catch (err) { toast.error(errorOf(err, 'Impossible de déconnecter cet appareil.')) }
    finally { setBusy(false) }
  }

  return (
    <ListRow
      icon={<Icon strokeWidth={1.75} />}
      iconTone="gray"
      title={withName ? `${s.username} · ${s.device}` : s.device}
      subtitle={`${placeOf(s)} · ${s.current ? 'cet appareil' : formatWhen(s.lastActiveAt)}`}
      aria-label={`${withName ? `${s.username}, ` : ''}${s.device}, ${placeOf(s)}`}
    >
      {s.current
        ? <span className="text-subhead text-label2 flex-shrink-0">Cet appareil</span>
        : <Button size="small" variant="destructive" loading={busy} onClick={() => void revoke()} aria-label={`Déconnecter ${s.device}`}>Déconnecter</Button>}
    </ListRow>
  )
}

export function DevicesGroup() {
  const { data: sessions, isError } = useQuery({ queryKey: ['sessions'], queryFn: usersService.sessions, refetchInterval: 60_000 })
  return (
    <Group
      id="appareils"
      header="Appareils connectés"
      footer="Le lieu est approximatif : Cloudflare le déduit de l’adresse IP (avec un VPN, c’est celui du VPN). Un nouvel appareil t’envoie une notification."
    >
      {isError ? (
        <EmptyState className="py-8" title="Appareils indisponibles" message="Le serveur n’a pas répondu. Réessaie dans un instant." />
      ) : !sessions ? <SkeletonRows rows={2} /> : sessions.length === 0
        ? <ListRow title={<span className="text-label2">Aucun appareil connecté</span>} />
        : sessions.map((s) => <DeviceRow key={s.id} s={s} />)}
    </Group>
  )
}

/* ── Journal des connexions ──────────────────────────────────────────────── */

function SignInRow({ e, withName = true }: { e: SignInEvent; withName?: boolean }) {
  const what = e.success ? (e.newDevice ? 'Nouvel appareil' : null) : SIGN_IN_REASON[e.reason]
  return (
    <ListRow
      icon={e.success ? <CheckCircle2 strokeWidth={1.75} /> : <XCircle strokeWidth={1.75} />}
      iconTone={e.success ? 'green' : 'red'}
      title={withName ? `${e.username} · ${e.device}` : e.device}
      subtitle={`${placeOf(e)} · ${formatWhen(e.at)}`}
      detail={what}
    />
  )
}

export function SignInsGroup() {
  const [all, setAll] = useState(false)
  const { data: events, isError } = useQuery({ queryKey: ['logins', 'all'], queryFn: () => usersService.logins({ limit: 100 }), refetchInterval: 60_000 })
  const shown = events?.slice(0, 8)
  return (
    <>
      <Group
        id="journal"
        header="Journal des connexions"
        footer="Chaque connexion à Nexus, réussie ou refusée, gardée 6 mois."
        action={events && events.length > 8 ? <button type="button" className="text-subhead text-accent-text hover:underline" onClick={() => setAll(true)}>Tout afficher</button> : undefined}
      >
        {isError ? (
          <EmptyState className="py-8" title="Journal indisponible" message="Le serveur n’a pas répondu. Réessaie dans un instant." />
        ) : !shown ? <SkeletonRows rows={3} /> : shown.length === 0
          ? <ListRow title={<span className="text-label2">Aucune connexion pour l’instant</span>} />
          : shown.map((e) => <SignInRow key={e.id} e={e} />)}
      </Group>
      <Sheet open={all} onClose={() => setAll(false)} title="Journal des connexions" size="md"
        phoneHeader={{ right: <Button variant="plain" className="font-semibold" onClick={() => setAll(false)}>OK</Button> }}
        footer={<Button variant="primary" onClick={() => setAll(false)} className="max-md:hidden">OK</Button>}>
        <Group>{(events ?? []).map((e) => <SignInRow key={e.id} e={e} />)}</Group>
      </Sheet>
    </>
  )
}
