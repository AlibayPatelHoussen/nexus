import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Download as DownloadIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { isAxiosError } from 'axios'
import {
  SOURCE_INFO, downloadsService, originalImage,
  type NewDownload, type TorrentGroup, type TorrentPack, type TorrentSeason, type TorrentVersion,
} from '@/services/downloadsService'
import { useShell } from '@/components/shell/shellContext'
import Sheet from '@/components/ui/Sheet'
import Button from '@/components/ui/Button'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { useConfirm } from '@/components/ui/useConfirm'
import Artwork from '@/components/media/Artwork'
import KindBadge from '@/components/downloads/KindBadge'
import { cn } from '@/utils'
import {
  filterOptions, matches, pick, recommended, sortVersions, versionDetails, versionLabel, type Preference,
} from './torrent'

/**
 * OxTorrent: one card per film / series, the versions (720p, 1080p, 4K,
 * VF, MULTI…) inside. Film: choose a version. Series: season, episodes, a
 * preferred quality for all of them, a version by hand per episode, packs.
 */

const pad = (n: number) => String(n).padStart(2, '0')
const ALL: Preference = { resolution: 'all', language: 'all' }

/** Résolution / Langue segmented controls (only the values present). */
function Filters({ versions, value, onChange, label }: { versions: TorrentVersion[]; value: Preference; onChange: (p: Preference) => void; label: string }) {
  const { res, langs } = filterOptions(versions)
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={label}>
      {res.length > 1 && (
        <SegmentedControl label="Résolution" value={value.resolution} onChange={(resolution) => onChange({ ...value, resolution })}
          options={[{ value: 'all', label: 'Toutes' }, ...res.map((r) => ({ value: r, label: r }))]} />
      )}
      {langs.length > 1 && (
        <SegmentedControl label="Langue" value={value.language} onChange={(language) => onChange({ ...value, language })}
          options={[{ value: 'all', label: 'Toutes' }, ...langs.map((l) => ({ value: l, label: l }))]} />
      )}
    </div>
  )
}

/** One version: resolution, language, source, codec, size, seeders. */
function VersionRow({ v, selected, best, onSelect, name }: { v: TorrentVersion; selected: boolean; best: boolean; onSelect: () => void; name: string }) {
  const dead = v.seeders === 0
  return (
    <label className={cn('flex items-center gap-3 px-3 py-2 rounded-[8px] cursor-pointer', selected ? 'bg-accent-soft' : 'hover:bg-fill', dead && 'opacity-50')}
      title={v.release}>
      <input type="radio" name={name} checked={selected} onChange={onSelect} className="accent-[var(--accent-fill)]" />
      <span className="flex-1 min-w-0">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-body font-medium text-label tabular">{versionLabel(v)}</span>
          {best && <span className="px-1.5 py-px rounded-[4px] bg-fill text-ok-text text-caption font-semibold">Recommandé</span>}
          {dead && <span className="text-caption text-label2">aucun seeder</span>}
        </span>
        <span className="block text-caption text-label2 truncate">{versionDetails(v)}</span>
      </span>
    </label>
  )
}

function VersionList({ versions, selected, onSelect, name, episode }: {
  versions: TorrentVersion[]; selected: string | null; onSelect: (v: TorrentVersion) => void; name: string; episode?: boolean
}) {
  const best = recommended(versions, episode)
  return (
    <div className="flex flex-col gap-0.5" role="radiogroup" aria-label="Versions">
      {sortVersions(versions).map((v) => (
        <VersionRow key={v.id} v={v} name={name} selected={selected === v.id} best={best?.id === v.id} onSelect={() => onSelect(v)} />
      ))}
    </div>
  )
}

interface Job { version: TorrentVersion; part?: string; item: string }

export default function TorrentSheet({ result, onClose }: { result: TorrentGroup | null; onClose: () => void }) {
  const { device } = useShell()
  const phone = device === 'phone'
  const qc = useQueryClient()
  const confirm = useConfirm()
  const r = result
  const film = r?.kind === 'film'
  const seasons: TorrentSeason[] = useMemo(() => (!film && r?.seasons) || [], [film, r])

  const [busy, setBusy] = useState(false)
  // Film
  const [filter, setFilter] = useState<Preference>(ALL)
  const [chosen, setChosen] = useState<string | null>(null)
  // Series
  const [seasonNo, setSeasonNo] = useState<number | null>(null)
  const [pref, setPref] = useState<Preference>(ALL)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [manual, setManual] = useState<Record<number, string>>({})
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    setFilter(ALL); setChosen(null); setPref(ALL); setChecked(new Set()); setManual({}); setOpen(null)
    setSeasonNo(seasons.at(-1)?.number ?? null)
  }, [r?.id, seasons])
  useEffect(() => { setChecked(new Set()); setManual({}); setOpen(null) }, [seasonNo])

  const versions = useMemo(() => (film ? r?.versions ?? [] : []), [film, r])
  const shown = useMemo(() => versions.filter((v) => matches(v, filter)), [versions, filter])
  useEffect(() => {
    if (!film) return
    if (!chosen || !shown.some((v) => v.id === chosen)) setChosen((recommended(shown) ?? sortVersions(shown)[0])?.id ?? null)
  }, [film, shown, chosen])

  const season = seasons.find((s) => s.number === seasonNo) ?? null
  const seasonVersions = useMemo(() => season ? [...season.episodes.flatMap((e) => e.versions), ...season.packs.flatMap((p) => p.versions)] : [], [season])
  const versionOf = (ep: { number: number; versions: TorrentVersion[] }) =>
    ep.versions.find((v) => v.id === manual[ep.number]) ?? pick(ep.versions, pref)

  if (!r) return <Sheet open={false} onClose={onClose} />

  async function enqueue(jobs: Job[]) {
    if (!r || !jobs.length) return
    setBusy(true)
    let added = 0, already = 0
    const replaceable: { job: Job; had: string }[] = []
    const send = (j: Job, extra: Partial<NewDownload> = {}) => downloadsService.create({
      id: j.version.id, title: r.title, poster_url: originalImage(r.poster_url), part: j.part, item: j.item,
      version: { resolution: j.version.resolution, language: j.version.language }, ...extra,
    })
    try {
      for (const j of jobs) {
        try { await send(j); added++ } catch (err) {
          const d = isAxiosError(err) && err.response?.status === 409 ? err.response.data?.details : null
          if (d?.replaceable) replaceable.push({ job: j, had: String(d.versions ?? '') })
          else if (d?.duplicate) already++
          else throw err
        }
      }
      if (replaceable.length) {
        setBusy(false)
        const one = replaceable.length === 1 ? replaceable[0] : null
        const ok = await confirm({
          title: one ? 'Déjà téléchargé' : `${replaceable.length} déjà téléchargés`,
          message: one
            ? `${[r.title, one.job.part].filter(Boolean).join(' — ')} est déjà téléchargé en ${one.had}. Le remplacer par la version ${versionLabel(one.job.version)} ? L’ancienne version sera supprimée une fois la nouvelle téléchargée.`
            : `${replaceable.length} éléments existent déjà dans une autre version. Les remplacer par les versions choisies ? Les anciennes seront supprimées une fois les nouvelles téléchargées.`,
          confirmLabel: 'Remplacer',
        })
        setBusy(true)
        if (ok) for (const { job } of replaceable) { await send(job, { replace: true }); added++ }
      }
      void qc.invalidateQueries({ queryKey: ['downloads'] })
      if (added) {
        toast.success(added === 1 ? `${r.title} ajouté à la file` : `${added} téléchargements ajoutés à la file`)
        onClose()
      } else if (already) toast(already === 1 ? 'Cette version est déjà téléchargée ou dans la file' : 'Ces versions sont déjà téléchargées ou dans la file')
    } catch (err) {
      toast.error(isAxiosError(err) ? err.response?.data?.error ?? 'Impossible d’ajouter ce téléchargement.' : 'Impossible d’ajouter ce téléchargement.')
    } finally {
      setBusy(false)
    }
  }

  const filmVersion = versions.find((v) => v.id === chosen) ?? null
  const episodeJobs = (): Job[] => (season?.episodes ?? []).filter((e) => checked.has(e.number)).flatMap((e) => {
    const v = versionOf(e)
    return v ? [{ version: v, part: `S${pad(season!.number)}E${pad(e.number)}`, item: `${r.id}:s${season!.number}e${e.number}` }] : []
  })
  const packJob = (p: TorrentPack, v: TorrentVersion): Job => ({
    version: v, item: `${r.id}:s${season!.number}:${p.episodes ? `e${p.episodes[0]}-${p.episodes.at(-1)}` : 'pack'}`,
    part: p.episodes ? `S${pad(season!.number)}E${pad(p.episodes[0])}–E${pad(p.episodes.at(-1)!)}` : `Saison ${season!.number} complète`,
  })

  const count = checked.size
  const action = film
    ? `Télécharger${filmVersion ? ` · ${versionLabel(filmVersion)}` : ''}`
    : `Télécharger${count ? ` ${count} épisode${count > 1 ? 's' : ''}` : ''}`
  const canQueue = !busy && (film ? !!filmVersion : count > 0)
  const footer = (
    <>
      {!phone && <Button onClick={onClose}>Annuler</Button>}
      <Button variant="primary" size={phone ? 'large' : 'regular'} loading={busy} disabled={!canQueue}
        onClick={() => { void enqueue(film ? (filmVersion ? [{ version: filmVersion, item: r.id }] : []) : episodeJobs()) }}>{action}</Button>
    </>
  )

  return (
    <Sheet open={!!r} onClose={onClose} size="lg" title={phone ? undefined : r.title} footer={footer}
      phoneHeader={{ left: <Button variant="plain" onClick={onClose}>Annuler</Button> }}>
      <div className="flex flex-col gap-5">
        <div className="flex gap-4">
          <Artwork src={r.poster_url} alt="" ratio="2 / 3" type={r.kind} title={r.title} loading="eager"
            className="flex-shrink-0 rounded-[8px] w-[96px] max-sm:w-[76px]" />
          <div className="min-w-0 flex flex-col gap-1.5">
            {phone && <h2 className="text-headline text-label">{r.title}</h2>}
            <div className="flex flex-wrap items-center gap-2 text-subhead text-label2">
              <KindBadge kind={r.kind} />
              {r.year && <span className="tabular">{r.year}</span>}
            </div>
            <p className="text-caption text-label2">
              Source : <span className="text-label">{SOURCE_INFO.oxtorrent.site}</span> · script <span className="font-mono">{SOURCE_INFO.oxtorrent.script}</span>
            </p>
            {r.description && <p className="text-subhead text-label2 line-clamp-4">{r.description}</p>}
          </div>
        </div>

        {film && (
          <div className="flex flex-col gap-3">
            <Filters versions={versions} value={filter} onChange={setFilter} label="Filtrer les versions" />
            {shown.length
              ? <VersionList versions={shown} selected={chosen} onSelect={(v) => setChosen(v.id)} name="film-version" />
              : <p className="text-subhead text-label2">Aucune version pour ces filtres.</p>}
          </div>
        )}

        {!film && season && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              {seasons.length > 1 && (
                <label className="relative inline-flex items-center">
                  <span className="sr-only">Saison</span>
                  <select value={season.number} onChange={(e) => setSeasonNo(Number(e.target.value))}
                    className="h-8 pl-3 pr-8 rounded-[8px] bg-fill text-label text-body appearance-none outline-none">
                    {seasons.map((s) => <option key={s.number} value={s.number}>Saison {s.number}</option>)}
                  </select>
                  <span className="pointer-events-none absolute right-2.5 text-label2 text-caption" aria-hidden="true">▾</span>
                </label>
              )}
              {seasons.length === 1 && <span className="text-subhead text-label">Saison {season.number}</span>}
            </div>

            {season.packs.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-caption font-semibold text-label2 uppercase tracking-wide">Packs</p>
                {season.packs.map((p) => (
                  <div key={p.label} className="rounded-[10px] bg-fill2 p-2 flex flex-col gap-1">
                    <p className="px-1 text-subhead font-medium text-label">{p.label}</p>
                    {sortVersions(p.versions).map((v) => (
                      <div key={v.id} className={cn('flex items-center gap-3 px-2 py-1.5 rounded-[8px]', v.seeders === 0 && 'opacity-50')} title={v.release}>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="text-body text-label tabular">{versionLabel(v)}</span>
                            {recommended(p.versions)?.id === v.id && <span className="px-1.5 py-px rounded-[4px] bg-fill text-ok-text text-caption font-semibold">Recommandé</span>}
                          </span>
                          <span className="block text-caption text-label2 truncate">{versionDetails(v)}</span>
                        </span>
                        <Button size="small" disabled={busy} onClick={() => { void enqueue([packJob(p, v)]) }}>
                          <DownloadIcon size={14} aria-hidden="true" /> Télécharger
                        </Button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {season.episodes.length > 0 && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <p className="text-caption font-semibold text-label2 uppercase tracking-wide">Qualité préférée</p>
                  <Filters versions={seasonVersions} value={pref} onChange={setPref} label="Qualité préférée" />
                  <p className="text-caption text-label2">Appliquée à chaque épisode coché ; sinon la meilleure version disponible.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="small" onClick={() => setChecked(new Set(season.episodes.map((e) => e.number)))}>Tout sélectionner</Button>
                  <Button size="small" variant="plain" disabled={!count} onClick={() => setChecked(new Set())}>Aucun</Button>
                </div>
                <div className="flex flex-col divide-y divide-separator rounded-[10px] bg-fill2" role="list" aria-label="Épisodes">
                  {season.episodes.map((e) => {
                    const v = versionOf(e)
                    const isOpen = open === e.number
                    return (
                      <div key={e.number} role="listitem" className="px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" checked={checked.has(e.number)} aria-label={`Épisode ${e.number}`}
                            onChange={() => setChecked((s) => { const n = new Set(s); if (n.has(e.number)) n.delete(e.number); else n.add(e.number); return n })}
                            className="accent-[var(--accent-fill)] w-4 h-4" />
                          <span className="flex-1 min-w-0">
                            <span className="block text-body text-label truncate">
                              <span className="tabular">E{pad(e.number)}</span>{e.title ? ` · ${e.title}` : ''}
                            </span>
                            <span className="block text-caption text-label2 truncate">
                              {v ? `${versionLabel(v)} · ${versionDetails(v)}` : '—'}{manual[e.number] ? ' · choisi à la main' : ''}
                            </span>
                          </span>
                          <button type="button" onClick={() => setOpen(isOpen ? null : e.number)} aria-expanded={isOpen}
                            className="flex items-center gap-1 h-7 px-2 rounded-[6px] text-caption text-accent-text hoverable">
                            {e.versions.length} version{e.versions.length > 1 ? 's' : ''}
                            <ChevronDown size={14} className={cn('transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
                          </button>
                        </div>
                        {isOpen && (
                          <div className="mt-1.5 ml-6">
                            <VersionList versions={e.versions} selected={v?.id ?? null} name={`ep-${e.number}`} episode
                              onSelect={(x) => { setManual((m) => ({ ...m, [e.number]: x.id })); setChecked((s) => new Set(s).add(e.number)) }} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                {count > 0 && (
                  <p className="text-caption text-label2 flex items-center gap-1.5">
                    <Check size={12} strokeWidth={2.5} className="text-ok-text" aria-hidden="true" />
                    {count} épisode{count > 1 ? 's' : ''} : {[...new Set(episodeJobs().map((j) => versionLabel(j.version)))].join(', ')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}
