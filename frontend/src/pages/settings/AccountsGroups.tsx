import { useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { isAxiosError } from 'axios'
import { CheckCircle2, Laptop, Smartphone, Tablet, Trash2, UserPlus, XCircle, type LucideIcon } from 'lucide-react'
import {
  DURATIONS, SIGN_IN_REASON, endOf, endOfDay, firstEndDay, usersService,
  type Account, type DeviceSession, type Duration, type SignInEvent,
} from '@/services/usersService'
import { useContextMenu } from '@/components/ui/useContextMenu'
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
  // A ready-made duration, or « Autre » : the end day of your choice
  const [duration, setDuration] = useState<Duration | 'date'>('1y')
  const [day, setDay] = useState('')
  const expiresAt = duration === 'date' ? endOfDay(day) : endOf(duration)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formId = useId()

  const nameOk = /^[A-Za-z0-9_-]{3,50}$/.test(username.trim())
  const passOk = password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)
  const valid = nameOk && /^\S+@\S+\.\S+$/.test(email.trim()) && passOk && (duration !== 'date' || !!expiresAt)

  function close() {
    if (saving) return
    onClose()
    setUsername(''); setEmail(''); setPassword(''); setDuration('1y'); setDay(''); setError(null)
  }

  async function submit() {
    if (!valid || saving) return
    setSaving(true); setError(null)
    try {
      await usersService.create({ username: username.trim(), email: email.trim(), password, expiresAt })
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
          <SegmentedControl<Duration | 'date'> label="Durée du compte" full value={duration} onChange={setDuration}
            options={[...DURATIONS.map((d) => ({ value: d.value, label: d.label })), { value: 'date' as const, label: 'Autre' }]} />
          {duration === 'date' && (
            <TextField label="Fin du compte" hideLabel type="date" min={firstEndDay()} value={day}
              onChange={(e) => { setDay(e.target.value); setError(null) }} aria-label="Date de fin du compte"
              error={day && !expiresAt ? 'Choisis une date après aujourd’hui.' : undefined} />
          )}
          <p className="text-caption text-label2">
            {duration === 'none' ? 'Le compte reste ouvert jusqu’à ce que tu le supprimes.'
              : expiresAt ? `Le compte se ferme le ${formatDay(expiresAt)} ; tu peux le prolonger.`
                : 'Choisis le dernier jour du compte.'}
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
  // « Choisir une date… » : the end day of your choice
  const [picking, setPicking] = useState(false)
  const [day, setDay] = useState('')
  const menu = useContextMenu()
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

  async function setDayEnd() {
    const end = endOfDay(day)
    if (!end) return
    await run(() => usersService.setExpiry(a!.id, end), `Compte ouvert jusqu’au ${formatDay(end)}`)
    setPicking(false); setDay('')
  }

  async function clearJournal() {
    const ok = await confirm({
      title: `Effacer les connexions de ${a!.username} ?`,
      message: 'Ses lignes du journal des connexions sont supprimées. Ses appareils restent connectés.',
      confirmLabel: 'Effacer', danger: true,
    })
    if (ok) await run(() => usersService.clearLogins(a!.id), 'Connexions effacées')
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
              {!picking && <Button size="small" variant="plain" disabled={busy} onClick={() => setPicking(true)}>Choisir une date…</Button>}
            </div>
            {picking && (
              <form role="listitem" className="nx-row relative flex flex-wrap items-center gap-2 px-4 py-3"
                onSubmit={(e) => { e.preventDefault(); void setDayEnd() }}>
                <TextField label="Dernier jour du compte" hideLabel type="date" min={firstEndDay()} value={day}
                  onChange={(e) => setDay(e.target.value)} aria-label="Dernier jour du compte" className="flex-1 min-w-[160px]" />
                <Button size="small" variant="primary" type="submit" disabled={busy || !endOfDay(day)}>Enregistrer</Button>
                <Button size="small" variant="plain" onClick={() => { setPicking(false); setDay('') }}>Annuler</Button>
              </form>
            )}
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
            : journal.map((e) => <SignInRow key={e.id} e={e} withName={false} menu={menu} />)}
        </Group>

        <Group>
          {devices.length > 0 && a.id !== me && <ListRow title="Déconnecter tous les appareils" destructive onClick={() => void signOutEverywhere()} disabled={busy} />}
          {(journal?.length ?? 0) > 0 && <ListRow title="Effacer ses connexions du journal…" destructive onClick={() => void clearJournal()} disabled={busy} />}
          {isUser && <ListRow title="Supprimer le compte…" destructive onClick={() => void remove()} disabled={busy} />}
          {!isUser && <ListRow wrap title={<span className="text-label2">Un compte administrateur se supprime dans le terminal : <code className="font-mono">bash scripts/delete-account.sh {a.username}</code></span>} />}
        </Group>
      </div>
      {menu.element}
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
      // The device on the first line (fits beside the button), who and where below (wraps)
      title={s.device}
      subtitle={[withName ? s.username : null, placeOf(s), s.current ? null : formatWhen(s.lastActiveAt)].filter(Boolean).join(' · ')}
      wrap
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

/** Removes one entry of the journal (and refreshes the lists showing it). */
function useDeleteLogin() {
  const qc = useQueryClient()
  return async (id: string) => {
    try {
      await usersService.deleteLogin(id)
      await qc.invalidateQueries({ queryKey: ['logins'] })
    } catch (err) { toast.error(errorOf(err, 'Impossible de supprimer cette entrée.')) }
  }
}

type Menu = ReturnType<typeof useContextMenu>

/**
 * One sign-in. Right click / long press: « Supprimer du journal »; with `trash`, a delete
 * button on the row too (the full journal).
 */
function SignInRow({ e, withName = true, menu, trash }: { e: SignInEvent; withName?: boolean; menu: Menu; trash?: boolean }) {
  const remove = useDeleteLogin()
  // What happened first on the second line (wraps): « Mot de passe incorrect · Lyon, France · hier à 21:04 »
  const what = e.success ? (e.newDevice ? 'Nouvel appareil' : null) : SIGN_IN_REASON[e.reason]
  return (
    <div className="contents" {...menu.bind([{ label: 'Supprimer du journal', icon: <Trash2 size={16} strokeWidth={1.75} />, destructive: true, onSelect: () => void remove(e.id) }])}>
    <ListRow
      icon={e.success ? <CheckCircle2 strokeWidth={1.75} /> : <XCircle strokeWidth={1.75} />}
      iconTone={e.success ? 'green' : 'red'}
      title={withName ? `${e.username} · ${e.device}` : e.device}
      subtitle={<>{what && <span className={e.success ? 'text-accent-text' : 'text-danger-text'}>{what} · </span>}{placeOf(e)} · {formatWhen(e.at)}</>}
      wrap
      aria-label={`${withName ? `${e.username}, ` : ''}${e.device}, ${what ?? 'connecté'}, ${placeOf(e)}, ${formatWhen(e.at)}`}
    >
      {trash && (
        <button type="button" onClick={() => void remove(e.id)} aria-label="Supprimer cette entrée du journal"
          className="flex-shrink-0 -mr-2 w-11 h-11 grid place-items-center rounded-full text-danger-text active:opacity-50">
          <Trash2 size={18} strokeWidth={1.75} />
        </button>
      )}
    </ListRow>
    </div>
  )
}

export function SignInsGroup() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const menu = useContextMenu()
  const [all, setAll] = useState(false)
  const { data: events, isError } = useQuery({ queryKey: ['logins', 'all'], queryFn: () => usersService.logins({ limit: 100 }), refetchInterval: 60_000 })
  const shown = events?.slice(0, 8)

  async function clearAll() {
    const ok = await confirm({
      title: 'Effacer tout le journal des connexions ?',
      message: 'Toutes les connexions enregistrées sont supprimées. Les appareils restent connectés.',
      confirmLabel: 'Tout effacer', danger: true,
    })
    if (!ok) return
    try {
      await usersService.clearLogins()
      await qc.invalidateQueries({ queryKey: ['logins'] })
      setAll(false)
      toast.success('Journal effacé')
    } catch (err) { toast.error(errorOf(err, 'Impossible d’effacer le journal.')) }
  }

  return (
    <>
      <Group
        id="journal"
        header="Journal des connexions"
        footer="Chaque connexion à Nexus, réussie ou refusée, gardée 6 mois. Clic droit ou appui long sur une ligne pour la supprimer."
        action={events?.length ? <button type="button" className="text-subhead text-accent-text hover:underline" onClick={() => setAll(true)}>{events.length > 8 ? 'Tout afficher' : 'Modifier'}</button> : undefined}
      >
        {isError ? (
          <EmptyState className="py-8" title="Journal indisponible" message="Le serveur n’a pas répondu. Réessaie dans un instant." />
        ) : !shown ? <SkeletonRows rows={3} /> : shown.length === 0
          ? <ListRow title={<span className="text-label2">Aucune connexion pour l’instant</span>} />
          : shown.map((e) => <SignInRow key={e.id} e={e} menu={menu} />)}
      </Group>
      <Sheet open={all} onClose={() => setAll(false)} title="Journal des connexions" size="md"
        phoneHeader={{
          left: <Button variant="destructive-plain" onClick={() => void clearAll()} disabled={!events?.length}>Tout effacer</Button>,
          right: <Button variant="plain" className="font-semibold" onClick={() => setAll(false)}>OK</Button>,
        }}
        footer={<>
          <Button variant="destructive" onClick={() => void clearAll()} disabled={!events?.length} className="max-md:hidden mr-auto">Tout effacer…</Button>
          <Button variant="primary" onClick={() => setAll(false)} className="max-md:hidden">OK</Button>
        </>}>
        {events?.length
          ? <Group>{events.map((e) => <SignInRow key={e.id} e={e} menu={menu} trash />)}</Group>
          : <EmptyState className="py-10" title="Journal vide" message="Les prochaines connexions s’afficheront ici." />}
        {menu.element}
      </Sheet>
      {!all && menu.element}
    </>
  )
}
