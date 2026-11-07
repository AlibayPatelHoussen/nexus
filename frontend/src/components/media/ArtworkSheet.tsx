import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { isAxiosError } from 'axios'
import { api } from '@/services/api'
import type { MediaItem } from '@/types'
import Sheet from '@/components/ui/Sheet'
import Button from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { cn } from '@/utils'

interface Choice { url: string; thumb: string; lang?: string | null }
interface Options { keyArts: Choice[]; logos: Choice[]; keyArt: string | null; logo: string | null; locked: boolean }

const LANG: Record<string, string> = { fr: 'Français', en: 'Anglais' }

/**
 * « Image et logo… » (admin): pick the billboard key art and the title logo among
 * TMDB's pictures, or the title in text. A choice made here is never replaced by the
 * automatic one; « Automatique » gives it back to Nexus.
 */
export default function ArtworkSheet({ media, open, onClose }: { media: MediaItem; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['artwork', media.id],
    queryFn: async () => (await api.get<{ data: Options }>(`/media/${media.id}/artwork`)).data.data,
    enabled: open,
    staleTime: 60_000,
  })
  const [keyArt, setKeyArt] = useState<string | null>(null)
  const [logo, setLogo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (data) { setKeyArt(data.keyArt ?? data.keyArts[0]?.url ?? null); setLogo(data.logo) } }, [data])

  async function save(body: object, done: string) {
    setBusy(true)
    try {
      const { data: res } = await api.put<{ data: MediaItem }>(`/media/${media.id}/artwork`, body)
      qc.setQueryData(['media', media.id], res.data)
      void qc.invalidateQueries({ queryKey: ['media'] })
      void qc.invalidateQueries({ queryKey: ['artwork', media.id] })
      toast.success(done)
      onClose()
    } catch (err) {
      toast.error(isAxiosError(err) ? err.response?.data?.error ?? 'Impossible d’enregistrer.' : 'Impossible d’enregistrer.')
    } finally { setBusy(false) }
  }

  const preview = data?.keyArts.find((k) => k.url === keyArt)?.thumb
  return (
    <Sheet open={open} onClose={onClose} title="Image et logo" size="lg" dismissible={!busy}
      footer={<>
        <Button variant="plain" disabled={busy || !data} onClick={() => save({ auto: true }, 'Choix automatique rétabli')}>Automatique</Button>
        <Button onClick={onClose} disabled={busy}>Annuler</Button>
        <Button variant="primary" loading={busy} disabled={!keyArt} onClick={() => save({ keyArt, logo }, 'Image et logo enregistrés')}>Enregistrer</Button>
      </>}>
      {isLoading ? <SkeletonRows rows={4} /> : isError || !data ? (
        <p className="text-subhead text-label2">Les images de ce titre n’ont pas pu être chargées depuis TMDB.</p>
      ) : (
        <div className="flex flex-col gap-6">
          <section aria-label="Image à la une">
            <h3 className="text-headline text-label mb-1">Image</h3>
            <p className="text-subhead text-label2 mb-3">Affichée en grand dans « À la une » et sur la fiche.</p>
            {data.keyArts.length === 0 ? <p className="text-subhead text-label2">TMDB n’a pas d’image sans texte pour ce titre.</p> : (
              <div role="radiogroup" aria-label="Image" className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                {data.keyArts.map((k, i) => (
                  <button key={k.url} type="button" role="radio" aria-checked={keyArt === k.url} aria-label={`Image ${i + 1}`}
                    onClick={() => setKeyArt(k.url)}
                    className={cn('relative aspect-[2/3] rounded-card overflow-hidden bg-fill', keyArt === k.url && 'ring-[3px] ring-accent ring-offset-2 ring-offset-[color:var(--bg)]')}>
                    <img src={k.thumb} alt="" loading="lazy" draggable={false} className="w-full h-full object-cover" />
                    {keyArt === k.url && <Check size={18} strokeWidth={3} className="absolute top-1.5 right-1.5 text-white drop-shadow" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            )}
          </section>
          <section aria-label="Logo du titre">
            <h3 className="text-headline text-label mb-1">Logo</h3>
            <p className="text-subhead text-label2 mb-3">Le nom du titre dans sa police, sur l’image.</p>
            <div role="radiogroup" aria-label="Logo" className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <LogoTile on={logo === null} onClick={() => setLogo(null)} preview={preview} label="Titre en texte">
                <span className="text-[22px] font-bold text-white text-center leading-tight px-2">{media.title}</span>
              </LogoTile>
              {data.logos.map((l, i) => (
                <LogoTile key={l.url} on={logo === l.url} onClick={() => setLogo(l.url)} preview={preview}
                  label={`Logo ${i + 1}${l.lang ? ` (${LANG[l.lang] ?? l.lang})` : ''}`} badge={l.lang ? LANG[l.lang] ?? l.lang : 'Sans langue'}>
                  <img src={l.thumb} alt="" loading="lazy" draggable={false} className="max-w-[85%] max-h-[70%] object-contain" />
                </LogoTile>
              ))}
            </div>
          </section>
        </div>
      )}
    </Sheet>
  )
}

/** A logo shown over the chosen image, as it will look on the billboard. */
function LogoTile({ on, onClick, preview, label, badge, children }: {
  on: boolean; onClick: () => void; preview?: string; label: string; badge?: string; children: React.ReactNode
}) {
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={label} onClick={onClick}
      className={cn('relative aspect-[16/9] rounded-card overflow-hidden grid place-items-center bg-fill', on && 'ring-[3px] ring-accent ring-offset-2 ring-offset-[color:var(--bg)]')}>
      {preview && <img src={preview} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" />}
      <span className="absolute inset-0" style={{ background: 'rgba(0,0,0,.45)' }} aria-hidden="true" />
      <span className="relative grid place-items-center w-full h-full">{children}</span>
      {badge && <span className="absolute left-1.5 bottom-1.5 px-1.5 rounded-pill text-caption font-semibold text-white" style={{ background: 'rgba(0,0,0,.55)' }}>{badge}</span>}
      {on && <Check size={18} strokeWidth={3} className="absolute top-1.5 right-1.5 text-white drop-shadow" aria-hidden="true" />}
    </button>
  )
}
