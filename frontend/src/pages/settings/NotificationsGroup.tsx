import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Group, ListRow } from '@/components/ui/GroupedList'
import Toggle from '@/components/ui/Toggle'
import Button from '@/components/ui/Button'
import { currentSubscription, disablePush, enablePush, pushSupport, testPush } from '@/services/pushService'

/** Réglages › Notifications: this device receives a notification when a download ends. */
export default function NotificationsGroup() {
  const support = pushSupport()
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (support !== 'ok') return
    currentSubscription().then((s) => setOn(!!s && Notification.permission === 'granted')).catch(() => {})
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

  const footer = {
    ok: 'Une notification quand un téléchargement se termine ou échoue, même quand Nexus est fermé. Chaque appareil s’active séparément.',
    'needs-home-screen': 'Sur iPhone, ajoute d’abord Nexus à l’écran d’accueil (Partager › Sur l’écran d’accueil), puis ouvre-le depuis son icône.',
    unsupported: 'Ce navigateur ne gère pas les notifications web.',
    insecure: 'Les notifications ont besoin d’une connexion HTTPS.',
  }[support]

  return (
    <Group header="Notifications" footer={footer}>
      <ListRow title="Téléchargements" subtitle={support === 'ok' ? 'Terminés ou échoués' : undefined}>
        <Toggle checked={on} onChange={(v) => { void toggle(v) }} disabled={busy || support !== 'ok'} label="Notifications des téléchargements" />
      </ListRow>
      {on && (
        <ListRow title="Essayer">
          <Button size="small" onClick={() => testPush().then((n) => (n ? toast.success('Notification envoyée') : toast.error('Aucun appareil abonné'))).catch(() => toast.error('Envoi impossible'))}>
            Envoyer un test
          </Button>
        </ListRow>
      )}
    </Group>
  )
}
