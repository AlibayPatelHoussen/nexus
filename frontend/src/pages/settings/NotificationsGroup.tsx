import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Group, ListRow } from '@/components/ui/GroupedList'
import Toggle from '@/components/ui/Toggle'
import Button from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'
import { disablePush, enablePush, pushSupport, resyncPush, testPush } from '@/services/pushService'

/** Réglages › Notifications: this device receives a notification when one of the account's downloads ends (admins: also a new device signing in). */
export default function NotificationsGroup() {
  const support = pushSupport()
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (support !== 'ok') return
    resyncPush().then(setOn).catch(() => {})
  }, [support])

  async function toggle(next: boolean) {
    setBusy(true)
    try {
      if (next) { await enablePush(); toast.success('Notifications activées sur cet appareil') }
      else { await disablePush(); toast('Notifications désactivées sur cet appareil') }
      setOn(next)
    } catch (err) {
      toast.error((err as Error).message === 'denied'
        ? 'Notifications refusées. Autorise-les dans les réglages du navigateur ou de l’iPhone.'
        : 'Impossible d’activer les notifications sur cet appareil.')
    } finally {
      setBusy(false)
    }
  }

  const isAdmin = useAuthStore((st) => st.user?.role === 'admin')
  const footer = {
    ok: `Une notification quand un de tes téléchargements se termine ou échoue${isAdmin ? ', et quand un nouvel appareil se connecte à Nexus' : ''}, même quand Nexus est fermé. Chaque appareil s’active séparément, pour le compte connecté dessus.`,
    'needs-home-screen': 'Sur iPhone, ajoute d’abord Nexus à l’écran d’accueil (Partager › Sur l’écran d’accueil), puis ouvre-le depuis son icône.',
    unsupported: 'Ce navigateur ne gère pas les notifications web.',
    insecure: 'Les notifications ont besoin d’une connexion HTTPS.',
  }[support]

  return (
    <Group header="Notifications" footer={footer}>
      <ListRow title={isAdmin ? 'Téléchargements et connexions' : 'Téléchargements'} subtitle={support === 'ok' ? (isAdmin ? 'Téléchargements terminés, nouveaux appareils' : 'Terminés ou échoués') : undefined}>
        <Toggle checked={on} onChange={(v) => { void toggle(v) }} disabled={busy || support !== 'ok'} label="Notifications des téléchargements" />
      </ListRow>
      {on && (
        <ListRow title="Essayer">
          <Button size="small" onClick={() => testPush().then((r) => {
            if (r.sent) toast.success('Notification envoyée')
            else if (!r.devices) toast.error('Aucun appareil abonné : désactive puis réactive l’interrupteur.')
            else toast.error(`Le service de notifications a refusé l’envoi (${r.errors[0] ?? 'erreur inconnue'})`)
          }).catch(() => toast.error('Envoi impossible'))}>
            Envoyer un test
          </Button>
        </ListRow>
      )}
    </Group>
  )
}
