import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowRight, Check } from 'lucide-react'
import { Group, ListRow } from '@/components/ui/GroupedList'
import Button from '@/components/ui/Button'
import Toggle from '@/components/ui/Toggle'
import Sheet from '@/components/ui/Sheet'
import EmptyState from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useShell } from '@/components/shell/shellContext'
import { renameService, type RenameResult, type RenameTitle } from '@/services/renameService'
import { serverError, showError } from '@/utils/errorToast'
import { formatWhen } from '@/utils'

const TYPE_LABEL: Record<RenameTitle['type'], string> = { film: 'Films', serie: 'Séries', anime: 'Animes' }
const files = (n: number) => `${n} fichier${n > 1 ? 's' : ''}`
/** « … » with non-breaking spaces (never a lone guillemet at the end of a line) */
const q = (s: string) => `«\u00a0${s}\u00a0»`

/**
 * Réglages › Bibliothèque (admins): the library under the names Jellyfin recognises. New downloads
 * are renamed as they finish (switch); what is already there, after a preview; the last renaming
 * can be undone.
 */
export default function RenameRows() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data: settings } = useQuery({ queryKey: ['rename', 'settings'], queryFn: renameService.settings })
  const { data: history } = useQuery({ queryKey: ['rename', 'history'], queryFn: renameService.history })
  const last = history?.find((b) => !b.undone)
  const [undoing, setUndoing] = useState(false)

  async function setAuto(auto: boolean) {
    qc.setQueryData(['rename', 'settings'], { auto })
    try { await renameService.setAuto(auto) } catch (err) {
      qc.setQueryData(['rename', 'settings'], { auto: !auto })
      showError('Réglage non enregistré', serverError(err))
    }
  }

  async function undo(batch: string) {
    setUndoing(true)
    try {
      const r = await renameService.undo(batch)
      toast.success(r.failed ? `${r.restored} remis, ${r.failed} impossible${r.failed > 1 ? 's' : ''}` : 'Noms d’origine remis')
      void qc.invalidateQueries({ queryKey: ['rename'] })
      void qc.invalidateQueries({ queryKey: ['media'] })
    } catch (err) { showError('Annulation impossible', serverError(err)) }
    finally { setUndoing(false) }
  }

  return (
    <>
      <ListRow wrap title="Noms pour Jellyfin"
        subtitle="Les nouveaux téléchargements prennent les noms que Jellyfin reconnaît."
        accessory={<Toggle checked={settings?.auto ?? true} onChange={setAuto} label="Renommer automatiquement les nouveaux téléchargements" disabled={!settings} />} />
      <ListRow wrap title="Renommer la bibliothèque" subtitle="Les films, séries et animes déjà là, après un aperçu.">
        <Button size="small" onClick={() => setOpen(true)}>Vérifier…</Button>
      </ListRow>
      {last && (
        <ListRow wrap title="Dernier renommage"
          subtitle={`${formatWhen(last.at)} · ${last.titles} titre${last.titles > 1 ? 's' : ''} · ${files(last.files)}${last.auto ? ' · automatique' : ''}`}>
          <Button size="small" variant="destructive" loading={undoing} onClick={() => undo(last.batch)}>Annuler</Button>
        </ListRow>
      )}
      <RenameSheet open={open} onClose={() => setOpen(false)} onUndo={undo} />
    </>
  )
}

function RenameSheet({ open, onClose, onUndo }: { open: boolean; onClose: () => void; onUndo: (batch: string) => Promise<void> }) {
  const qc = useQueryClient()
  const phone = useShell().device === 'phone'
  const { data: plan, isLoading, isError, refetch } = useQuery({
    queryKey: ['rename', 'plan'], queryFn: renameService.plan, enabled: open, staleTime: 0, gcTime: 0,
  })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RenameResult | null>(null)
  const todo = plan?.titles.filter((t) => t.files > 0 || t.merge) ?? []
  const left = plan?.titles.filter((t) => t.skipped.length) ?? []

  async function apply() {
    setBusy(true)
    try {
      const r = await renameService.apply(todo.map((t) => t.mediaId))
      setResult(r)
      const n = r.renamed.length
      if (n) toast.success(`${n} titre${n > 1 ? 's' : ''} renommé${n > 1 ? 's' : ''}`)
      void qc.invalidateQueries({ queryKey: ['rename'] })
      void qc.invalidateQueries({ queryKey: ['media'] })
    } catch (err) { showError('Renommage impossible', serverError(err)) }
    finally { setBusy(false) }
  }
  const close = () => { setResult(null); onClose() }

  const action = result
    ? <Button variant={phone ? 'plain' : 'primary'} className={phone ? 'font-semibold' : undefined} onClick={close}>OK</Button>
    : <Button variant={phone ? 'plain' : 'primary'} className={phone ? 'font-semibold' : undefined} loading={busy} disabled={!todo.length} onClick={apply}>
        {phone ? 'Renommer' : `Tout renommer${plan ? ` (${files(plan.files)})` : ''}`}
      </Button>

  return (
    <Sheet open={open} onClose={close} title="Noms pour Jellyfin" size="lg" dismissible={!busy}
      phoneHeader={{ left: <Button variant="plain" onClick={close}>{result ? 'Fermer' : 'Annuler'}</Button>, right: action }}
      footer={phone ? undefined : <>{!result && <Button onClick={close}>Annuler</Button>}{action}</>}>
      {result ? (
        <div className="flex flex-col gap-6">
          <EmptyState className="py-6" icon={<Check strokeWidth={1.5} />}
            title={result.renamed.length ? `${result.renamed.length} titre${result.renamed.length > 1 ? 's' : ''} renommé${result.renamed.length > 1 ? 's' : ''}` : 'Rien n’a été renommé'}
            message={`Nexus suit les nouveaux noms : progression, favoris et ${q('Reprendre')} sont gardés. Jellyfin les reprend à sa prochaine analyse.`}
            action={result.renamed.length ? <Button variant="destructive" onClick={async () => { await onUndo(result.batch); close() }}>Annuler ce renommage</Button> : undefined} />
          {result.errors.length > 0 && (
            <Group header="Pas renommés">
              {result.errors.map((e) => <ListRow key={e.title} wrap title={e.title} subtitle={e.error} status="error" />)}
            </Group>
          )}
        </div>
      ) : isLoading ? (
        <Group><SkeletonRows rows={5} /></Group>
      ) : isError ? (
        <EmptyState tone="error" title="Aperçu indisponible" message="Le serveur n’a pas répondu." action={<Button onClick={() => refetch()}>Réessayer</Button>} />
      ) : !todo.length && !left.length ? (
        <EmptyState icon={<Check strokeWidth={1.5} />} title="Tout est déjà nommé pour Jellyfin" message="Les films, séries et animes de la bibliothèque ont déjà leurs noms au bon format." />
      ) : (
        <div className="flex flex-col gap-6">
          <p className="text-subhead text-label2 px-1">
            {todo.length} titre{todo.length > 1 ? 's' : ''} · {plan ? files(plan.files) : ''} à renommer, au format {q('Titre (Année)')},
            {' '}{q('Season 01')}, {q('Titre S01E01')}. Nexus suit les nouveaux noms (progression et favoris gardés) ; {q('Annuler')} remet
            les noms d’origine.
          </p>
          {(['film', 'serie', 'anime'] as const).map((type) => {
            const rows = todo.filter((t) => t.type === type)
            return rows.length ? (
              <Group key={type} header={TYPE_LABEL[type]}>
                {rows.map((t) => <PlanRow key={t.mediaId} t={t} />)}
              </Group>
            ) : null
          })}
          {left.length > 0 && (
            <Group header="Laissés tels quels" footer="Un fichier en cours de lecture ou de téléchargement est renommé plus tard.">
              {left.flatMap((t) => t.skipped.map((s) => (
                <ListRow key={`${t.mediaId}-${s.name}`} wrap title={t.title} subtitle={`${s.name} : ${s.reason}`} />
              )))}
            </Group>
          )}
        </div>
      )}
    </Sheet>
  )
}

/** One title: its name now → its name once renamed, and how many files move */
function PlanRow({ t }: { t: RenameTitle }) {
  return (
    <div role="listitem" className="nx-row relative px-4 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-label font-medium truncate">{t.title}</span>
        <span className="text-subhead text-label2 tabular flex-shrink-0">{t.merge ? 'rejoint son dossier' : files(t.files)}</span>
      </div>
      <p className="mt-1 text-subhead text-label2 [overflow-wrap:anywhere]">
        <span className="line-through decoration-label3">{t.from}</span>
        <ArrowRight size={12} strokeWidth={2} className="inline mx-1 -mt-0.5 text-label3" aria-label="devient" />
        <span className="text-label">{t.to}</span>
      </p>
      {t.examples.length > 1 && (
        <p className="mt-0.5 text-caption text-label2 truncate">ex. {t.examples[t.examples.length - 1].to}</p>
      )}
    </div>
  )
}
