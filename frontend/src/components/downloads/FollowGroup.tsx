import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import toast from 'react-hot-toast'
import { useState } from 'react'
import { api } from '@/services/api'
import { downloadsService, langLabel, type Follow } from '@/services/downloadsService'
import { Group, ListRow } from '@/components/ui/GroupedList'
import Toggle from '@/components/ui/Toggle'
import Spinner from '@/components/ui/Spinner'

interface Target { sourceId: string; title: string; poster_url: string | null; lang: string; season?: string; follow: Follow | null }

const seasonLabel = (s?: string) => !s ? '' : /^\d+$/.test(s) ? `Saison ${s}` : s.replace(/^saison(\d+)/, 'Saison $1').replace(/^(kai|film|oav)(\d+)$/, '$1 $2').replace(/^\w/, (c) => c.toUpperCase())

/** Library page of an anime / series / manga: « Télécharger automatiquement les nouveautés ». */
export default function FollowGroup({ mediaId, kind }: { mediaId: string; kind: 'anime' | 'serie' | 'manga' }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const { data: target, isLoading, error } = useQuery({
    queryKey: ['follow-target', mediaId],
    queryFn: async () => (await api.get<{ data: Target }>(`/downloads/follows/media/${mediaId}`)).data.data,
    retry: false, staleTime: 5 * 60_000,
  })
  const on = !!target?.follow?.enabled
  const noun = kind === 'manga' ? 'nouveaux chapitres' : 'nouveaux épisodes'

  async function toggle(next: boolean) {
    if (!target) return
    setBusy(true)
    try {
      const follow = await downloadsService.setFollow({
        id: target.sourceId, enabled: next, title: target.title, poster_url: target.poster_url, lang: target.lang,
        ...(kind !== 'manga' ? { season: target.season } : {}),
      })
      qc.setQueryData<Target>(['follow-target', mediaId], { ...target, follow })
      toast.success(next ? `Les ${noun} seront téléchargés automatiquement` : 'Téléchargement automatique désactivé')
    } catch (err) {
      toast.error(isAxiosError(err) ? err.response?.data?.error ?? 'Impossible de changer ce réglage.' : 'Impossible de changer ce réglage.')
    } finally {
      setBusy(false)
    }
  }

  const where = target ? [kind !== 'manga' ? seasonLabel(target.follow?.options.season ?? target.season) : null, langLabel(target.follow?.options.lang ?? target.lang)].filter(Boolean).join(' · ') : ''
  const subtitle = isLoading
    ? <span className="inline-flex items-center gap-1.5"><Spinner size={12} />Recherche du titre sur le site…</span>
    : error
      ? (isAxiosError(error) && error.response?.data?.error) || 'Titre introuvable sur le site'
      : on
        ? `Les ${noun} · ${where} · vérifié chaque jour${target?.follow?.last_error ? ` · dernier essai : ${target.follow.last_error}` : ''}`
        : `Désactivé : rien ne se télécharge sans toi.${where ? ` Une fois activé : les ${noun} (${where}).` : ''}`

  return (
    <Group header="Téléchargements" footer="Ce qui existe déjà n’est jamais téléchargé automatiquement : seulement ce qui sort après l’activation.">
      <ListRow wrap title="Téléchargement automatique" subtitle={subtitle}>
        <Toggle checked={on} disabled={busy || !target} onChange={(v) => { void toggle(v) }} label={`Télécharger automatiquement les ${noun}`} />
      </ListRow>
    </Group>
  )
}
