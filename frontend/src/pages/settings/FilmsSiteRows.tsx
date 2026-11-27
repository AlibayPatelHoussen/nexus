import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ListRow } from '@/components/ui/GroupedList'
import Button from '@/components/ui/Button'
import { downloadsService, type FilmsSite } from '@/services/downloadsService'
import { serverError, showError } from '@/utils/errorToast'
import { formatDay } from '@/utils'

/** How the address came: the script's, found by itself when the site moved, pasted here */
function howText(site: FilmsSite): string {
  const when = site.found ? ` le ${formatDay(site.found)}` : ''
  switch (site.how) {
    case 'redirect':
    case 'mirror':
    case 'saved': return `Nouvelle adresse trouvée toute seule${when}`
    case 'manual': return `Collée ici${when}`
    default: return 'Suivie toute seule quand le site change d’adresse'
  }
}

/**
 * Réglages › Bibliothèque (admins): the films site (films.py) moves from one domain to another. The
 * script follows it by itself; when it could not, the new link is pasted here (tried first).
 */
export default function FilmsSiteRows() {
  const qc = useQueryClient()
  const { data: site } = useQuery({ queryKey: ['downloads', 'films-site'], queryFn: downloadsService.filmsSite })
  const [editing, setEditing] = useState(false)
  const [link, setLink] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!site) return null

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const next = await downloadsService.setFilmsSite(link)
      qc.setQueryData(['downloads', 'films-site'], next)
      toast.success(`Site de films : ${next.host}`)
      setEditing(false); setLink('')
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 422) setError('Ce n’est pas une adresse : colle le lien du site (https://…).')
      else showError('Adresse non enregistrée', serverError(err))
    } finally { setSaving(false) }
  }

  return (
    <>
      <ListRow wrap title={`Site de films · ${site.host}`} subtitle={howText(site)}>
        {!editing && <Button size="small" onClick={() => { setEditing(true); setLink('') }}>Changer…</Button>}
      </ListRow>
      {editing && (
        <form role="listitem" onSubmit={save} className="nx-row relative flex flex-col gap-2 px-4 py-2.5">
          <label htmlFor="films-site" className="sr-only">Nouvelle adresse du site de films</label>
          <input
            id="films-site" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus
            value={link} onChange={(e) => { setLink(e.target.value); setError(null) }} placeholder={site.url} maxLength={500}
            className="w-full min-w-0 bg-transparent outline-none text-label placeholder:text-label3 py-2"
            aria-invalid={!!error || undefined} aria-describedby={error ? 'films-site-error' : undefined}
          />
          {error && <p id="films-site-error" role="alert" className="text-subhead text-danger-text">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="plain" onClick={() => { setEditing(false); setError(null) }}>Annuler</Button>
            <Button type="submit" variant="primary" loading={saving} disabled={!link.trim()}>Enregistrer</Button>
          </div>
        </form>
      )}
    </>
  )
}
