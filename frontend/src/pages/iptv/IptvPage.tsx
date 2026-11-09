import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  ArrowDownAZ, ArrowUpZA, ChevronDown, ChevronRight, ChevronUp, Globe, Heart, History, House, Languages, LayoutGrid, RefreshCw,
  Settings2, Shapes, Tv,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Page from '@/components/shell/Page'
import { useShell } from '@/components/shell/shellContext'
import { SectionMenu } from '@/components/media/PhoneLibraryBar'
import SearchField from '@/components/ui/SearchField'
import PullDownMenu from '@/components/ui/PullDownMenu'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import Skeleton from '@/components/ui/Skeleton'
import Toggle from '@/components/ui/Toggle'
import TextField from '@/components/ui/TextField'
import { Group, ListRow } from '@/components/ui/GroupedList'
import { useDebounce } from '@/hooks/useDebounce'
import { useAuthStore } from '@/stores/authStore'
import { spring } from '@/design/motion'
import { cn } from '@/utils'
import { serverError } from '@/utils/errorToast'
import { iptvService, type IptvChannel, type IptvSummary } from '@/services/iptvService'
import { CHANNEL_GRID, ChannelLogo, ChannelTile, useInfiniteTrigger, useOpenChannel } from './ChannelTile'
import { MAIN_CATEGORIES, categoryName, countryName, flag, languageName } from './labels'

type View = 'accueil' | 'chaines' | 'favoris' | 'pays' | 'categories' | 'langues' | 'recents' | 'reglages'
const VIEWS: { id: View; label: string; icon: typeof House }[] = [
  { id: 'accueil', label: 'Accueil', icon: House },
  { id: 'chaines', label: 'Toutes les chaînes', icon: LayoutGrid },
  { id: 'favoris', label: 'Favoris', icon: Heart },
  { id: 'pays', label: 'Pays', icon: Globe },
  { id: 'categories', label: 'Catégories', icon: Shapes },
  { id: 'langues', label: 'Langues', icon: Languages },
  { id: 'recents', label: 'Récemment regardées', icon: History },
  { id: 'reglages', label: 'Paramètres IPTV', icon: Settings2 },
]
const PHONE_LABEL: Partial<Record<View, string>> = { chaines: 'Chaînes', recents: 'Récentes', reglages: 'Paramètres' }

/**
 * IPTV: the iptv-org channels (https://github.com/iptv-org/iptv), watched live in Nexus.
 * Desktop: the IPTV sections in a column next to the content; iPhone: capsules under the title.
 */
export default function IptvPage() {
  const { view: raw } = useParams<{ view?: string }>()
  const view: View = (VIEWS.some((v) => v.id === raw) ? raw : 'accueil') as View
  const { device } = useShell()
  const phone = device === 'phone'
  const current = VIEWS.find((v) => v.id === view)!

  const content = (
    <>
      {view === 'accueil' && <HomeView />}
      {view === 'chaines' && <ChannelsView />}
      {view === 'favoris' && <FavoritesView />}
      {view === 'pays' && <FacetView kind="country" />}
      {view === 'categories' && <FacetView kind="category" />}
      {view === 'langues' && <FacetView kind="language" />}
      {view === 'recents' && <RecentView />}
      {view === 'reglages' && <SettingsView />}
    </>
  )

  return (
    <Page
      title={phone || view === 'accueil' ? 'IPTV' : current.label}
      subtitle={!phone && view === 'accueil' ? 'Chaînes de télévision en direct' : undefined}
      leading={phone ? <SectionMenu value="iptv" /> : undefined}
      accessory={phone ? <PhoneNav view={view} /> : undefined}
    >
      {phone ? content : (
        <div className="flex gap-8 items-start">
          <DesktopNav view={view} />
          <div className="flex-1 min-w-0">{content}</div>
        </div>
      )}
    </Page>
  )
}

function DesktopNav({ view }: { view: View }) {
  return (
    <nav aria-label="Sections IPTV" className="w-60 flex-shrink-0 sticky top-[calc(var(--toolbar-h)+16px)]">
      <ul className="flex flex-col gap-0.5">
        {VIEWS.map((v) => {
          const on = v.id === view
          return (
            <li key={v.id} className="relative">
              {on && <motion.span layoutId="iptv-nav" transition={spring.selection} className="absolute inset-0 rounded-pill bg-fill" aria-hidden="true" />}
              <Link
                to={v.id === 'accueil' ? '/iptv' : `/iptv/${v.id}`}
                aria-current={on ? 'page' : undefined}
                className={cn('relative flex items-center gap-3 h-10 px-3.5 rounded-pill text-body', on ? 'text-label font-semibold' : 'text-label2 hover:text-label')}
              >
                <v.icon size={18} strokeWidth={on ? 2.25 : 1.75} className={on ? 'text-accent' : ''} aria-hidden="true" />
                {v.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function PhoneNav({ view }: { view: View }) {
  return (
    <nav aria-label="Sections IPTV" className="-mx-4 px-4 overflow-x-auto scrollbar-none">
      <ul className="flex gap-2 w-max pb-1">
        {VIEWS.map((v) => {
          const on = v.id === view
          return (
            <li key={v.id}>
              <Link
                to={v.id === 'accueil' ? '/iptv' : `/iptv/${v.id}`}
                aria-current={on ? 'page' : undefined}
                className={cn('flex items-center gap-1.5 h-9 px-3.5 rounded-pill text-subhead font-semibold transition-colors',
                  on ? 'bg-accent-fill text-white' : 'bg-fill text-label')}
              >
                <v.icon size={15} strokeWidth={2} aria-hidden="true" />
                {PHONE_LABEL[v.id] ?? v.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

// ─── Home ─────────────────────────────────────────────────────────────────────
function useSummary() {
  return useQuery({
    queryKey: ['iptv', 'summary'],
    queryFn: iptvService.summary,
    // While the catalogue is being downloaded, look again every few seconds
    refetchInterval: (q) => (q.state.data && (q.state.data.total === 0 || q.state.data.refresh.running) ? 4000 : false),
  })
}

function HomeView() {
  const { data, isLoading, isError, refetch } = useSummary()
  const open = useOpenChannel()
  const navigate = useNavigate()
  // A first shelf of channels: the verified ones when checks have run, else the catalogue A→Z
  const onlineFirst = (data?.online ?? 0) > 0
  const sample = useQuery({
    queryKey: ['iptv', 'channels', 'home', onlineFirst],
    queryFn: () => iptvService.channels({ limit: 20, sort: 'name', ...(onlineFirst ? { status: 'online' } : {}) }),
    enabled: !!data && data.total > 0,
    staleTime: 60_000,
  })
  if (isLoading) return <HomeSkeleton />
  if (isError || !data) return <EmptyState tone="error" title="IPTV indisponible" message="Le serveur n’a pas répondu." action={<Button variant="plain" onClick={() => refetch()}>Réessayer</Button>} />
  if (data.total === 0) return <EmptyCatalogue summary={data} />

  const mainCats = [...data.categories].sort((a, b) => {
    const ia = MAIN_CATEGORIES.indexOf(a.id), ib = MAIN_CATEGORIES.indexOf(b.id)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b.count - a.count
  })
  return (
    <div className="flex flex-col gap-9">
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Chaînes" value={data.total} />
        <Stat label="Disponibles" value={data.online} hint={data.checked ? `sur ${data.checked.toLocaleString('fr-FR')} vérifiées` : 'vérification en cours'} />
        <Stat label="Pays" value={data.countries.length ? (data.refresh.stats?.countries ?? data.countries.length) : 0} />
        <Stat label="Catégories" value={data.categories.length} />
      </dl>

      {!!sample.data?.items.length && (
        <Shelf title={onlineFirst ? 'Chaînes disponibles' : 'Toutes les chaînes'} items={sample.data.items} onOpen={open}
          more={onlineFirst ? '/iptv/chaines?online=1' : '/iptv/chaines'} />
      )}
      {data.recent.length > 0 && <Shelf title="Récemment regardées" items={data.recent} onOpen={open} more="/iptv/recents" />}
      {data.favorites.length > 0 && <Shelf title="Favoris" items={data.favorites} onOpen={open} more="/iptv/favoris" />}
      {/* Real plays on this server only: iptv-org publishes no audience figures */}
      {data.popular.length > 0 && <Shelf title="Les plus regardées sur ce serveur" items={data.popular} onOpen={open} />}

      <section aria-labelledby="iptv-cats">
        <SectionTitle id="iptv-cats" title="Catégories" to="/iptv/categories" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {mainCats.slice(0, 8).map((c) => (
            <FacetTile key={c.id} title={categoryName(c.id, c.name)} count={c.count} onClick={() => navigate(`/iptv/chaines?category=${c.id}`)} />
          ))}
        </div>
      </section>

      <section aria-labelledby="iptv-countries">
        <SectionTitle id="iptv-countries" title="Chaînes par pays" to="/iptv/pays" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {data.countries.slice(0, 8).map((c) => (
            <FacetTile key={c.code} lead={c.flag ?? flag(c.code)} title={countryName(c.code, c.name)} count={c.count}
              onClick={() => navigate(`/iptv/chaines?country=${c.code}`)} />
          ))}
        </div>
      </section>
      <SourceNote summary={data} />
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-group bg-surface px-4 py-3.5">
      <dt className="text-subhead text-label2">{label}</dt>
      <dd className="text-title text-label tabular mt-0.5">{value.toLocaleString('fr-FR')}</dd>
      {hint && <dd className="text-caption text-label2 mt-0.5">{hint}</dd>}
    </div>
  )
}

function SectionTitle({ id, title, to }: { id: string; title: string; to?: string }) {
  return (
    <h2 id={id} className="mb-3 text-[17px] md:text-[19px] font-bold leading-[22px] text-label">
      {to ? (
        <Link to={to} title={`Tout voir : ${title}`} className="inline-flex items-center gap-0.5 rounded-control hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {title}
          <ChevronRight size={20} strokeWidth={2.5} className="text-label2 translate-y-px" aria-hidden="true" />
        </Link>
      ) : title}
    </h2>
  )
}

function Shelf({ title, items, onOpen, more }: { title: string; items: IptvChannel[]; onOpen: (c: IptvChannel, l: IptvChannel[]) => void; more?: string }) {
  const id = `shelf-${title.replace(/\W+/g, '-')}`
  return (
    <section aria-labelledby={id}>
      <SectionTitle id={id} title={title} to={more} />
      <div className="-mx-4 px-4 md:mx-0 md:px-0 overflow-x-auto scrollbar-none">
        <ul className="flex gap-4 w-max">
          {items.map((c) => (
            <li key={c.id} className="w-[44vw] sm:w-48">
              <ChannelTile channel={c} onOpen={(ch) => onOpen(ch, items)} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function FacetTile({ title, count, lead, onClick }: { title: string; count: number; lead?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-3 min-h-[56px] px-4 py-3 rounded-group bg-surface text-left hoverable active:scale-[0.98] transition-transform duration-fast ease-out">
      {lead && <span className="text-[22px] leading-none" aria-hidden="true">{lead}</span>}
      <span className="flex-1 min-w-0">
        <span className="block text-body font-semibold text-label truncate">{title}</span>
        <span className="block text-caption text-label2 tabular">{count.toLocaleString('fr-FR')} chaîne{count > 1 ? 's' : ''}</span>
      </span>
    </button>
  )
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-group" />)}</div>
      <div className={CHANNEL_GRID}>{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="w-full aspect-video rounded-card" />)}</div>
    </div>
  )
}

function SourceNote({ summary }: { summary: IptvSummary }) {
  const at = summary.refresh.at ? new Date(summary.refresh.at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : null
  return (
    <p className="text-caption text-label2 max-w-[70ch]">
      Chaînes publiques référencées par <a className="text-accent-text" href="https://github.com/iptv-org/iptv" target="_blank" rel="noreferrer">iptv-org</a>
      {at ? ` · catalogue du ${at}` : ''}. Les chaînes retirées à la demande des ayants droit et les contenus pour adultes ne sont pas proposés.
      Certaines chaînes ne sont visibles que depuis leur pays ou pas 24 h/24.
    </p>
  )
}

function EmptyCatalogue({ summary }: { summary: IptvSummary }) {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const refresh = useRefresh()
  const running = summary.refresh.running || refresh.isPending
  return (
    <EmptyState
      icon={<Tv strokeWidth={1.25} />}
      tone={summary.refresh.ok === false ? 'error' : 'neutral'}
      title={running ? 'Téléchargement du catalogue…' : summary.refresh.ok === false ? 'Catalogue indisponible' : 'Catalogue pas encore téléchargé'}
      message={running ? 'Les chaînes d’iptv-org arrivent dans quelques secondes.'
        : summary.refresh.ok === false ? summary.refresh.message ?? undefined
          : 'Le serveur télécharge la liste des chaînes au démarrage, puis une fois par jour.'}
      action={isAdmin && !running ? <Button variant="plain" onClick={() => refresh.mutate()}>Télécharger maintenant</Button> : undefined}
    />
  )
}

function useRefresh() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: iptvService.refresh,
    onSuccess: () => { toast.success('Actualisation du catalogue lancée'); void qc.invalidateQueries({ queryKey: ['iptv'] }) },
    onError: (e) => toast.error(serverError(e)),
  })
}

// ─── All channels (filters) ───────────────────────────────────────────────────
function ChannelsView() {
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState(params.get('q') ?? '')
  const q = useDebounce(text, 250)
  const country = params.get('country') ?? ''
  const category = params.get('category') ?? ''
  const language = params.get('language') ?? ''
  const sort = params.get('sort') === '-name' ? '-name' : 'name'
  const online = params.get('online') === '1'
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    setParams(next, { replace: true })
  }
  useEffect(() => { if ((params.get('q') ?? '') !== q) set('q', q) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const facets = useQuery({ queryKey: ['iptv', 'facets'], queryFn: iptvService.facets, staleTime: 5 * 60_000 })
  const filters = { q, country, category, language, sort: sort as 'name' | '-name', status: online ? 'online' as const : 'all' as const }
  const list = useInfiniteQuery({
    queryKey: ['iptv', 'channels', filters],
    queryFn: ({ pageParam }) => iptvService.channels({ ...filters, page: pageParam, limit: 60 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
  })
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data])
  const total = list.data?.pages[0]?.total ?? 0
  const more = useInfiniteTrigger(() => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage() }, !!list.hasNextPage)
  const open = useOpenChannel()
  const f = facets.data
  const anyFilter = !!(q || country || category || language || online)

  return (
    <div className="flex flex-col gap-4">
      <SearchField value={text} onChange={setText} label="Rechercher une chaîne" placeholder="Rechercher une chaîne" />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtres">
        <FilterMenu label="Pays" value={country} onChange={(v) => set('country', v)}
          options={(f?.countries ?? []).map((c) => ({ value: c.code, label: `${c.flag ?? flag(c.code)} ${countryName(c.code, c.name)} (${c.count})` }))} />
        <FilterMenu label="Catégorie" value={category} onChange={(v) => set('category', v)}
          options={(f?.categories ?? []).map((c) => ({ value: c.id, label: `${categoryName(c.id, c.name)} (${c.count})` }))} />
        <FilterMenu label="Langue" value={language} onChange={(v) => set('language', v)}
          options={(f?.languages ?? []).map((l) => ({ value: l.code, label: `${languageName(l.code, l.name)} (${l.count})` }))} />
        <button type="button" onClick={() => set('online', online ? '' : '1')} aria-pressed={online}
          className={cn('h-9 px-3.5 rounded-pill text-subhead font-semibold', online ? 'bg-accent-fill text-white' : 'bg-fill text-label')}>
          Disponibles
        </button>
        <button type="button" onClick={() => set('sort', sort === 'name' ? '-name' : '')}
          className="h-9 px-3 rounded-pill bg-fill text-label inline-flex items-center gap-1.5 text-subhead font-semibold"
          aria-label={sort === 'name' ? 'Tri de A à Z (changer pour Z à A)' : 'Tri de Z à A (changer pour A à Z)'}>
          {sort === 'name' ? <ArrowDownAZ size={16} aria-hidden="true" /> : <ArrowUpZA size={16} aria-hidden="true" />}
          {sort === 'name' ? 'A → Z' : 'Z → A'}
        </button>
        {anyFilter && <Button variant="plain" size="small" onClick={() => { setText(''); setParams(new URLSearchParams(), { replace: true }) }}>Effacer</Button>}
      </div>
      <p className="text-subhead text-label2 tabular" aria-live="polite">
        {list.isLoading ? 'Chargement…' : `${total.toLocaleString('fr-FR')} chaîne${total > 1 ? 's' : ''}`}
      </p>
      {list.isLoading ? (
        <div className={CHANNEL_GRID}>{Array.from({ length: 18 }).map((_, i) => <Skeleton key={i} className="w-full aspect-video rounded-card" />)}</div>
      ) : list.isError ? (
        <EmptyState tone="error" title="Liste indisponible" message={serverError(list.error)} action={<Button variant="plain" onClick={() => list.refetch()}>Réessayer</Button>} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Tv strokeWidth={1.25} />} title="Aucune chaîne" message={anyFilter ? 'Aucune chaîne ne correspond à ces filtres.' : 'Le catalogue est vide pour le moment.'} />
      ) : (
        <>
          <ul className={CHANNEL_GRID}>
            {items.map((c) => <li key={c.id}><ChannelTile channel={c} onOpen={(ch) => open(ch, items)} /></li>)}
          </ul>
          <div ref={more} aria-hidden="true" className="h-1" />
          {list.isFetchingNextPage && <div className={CHANNEL_GRID}>{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="w-full aspect-video rounded-card" />)}</div>}
        </>
      )}
    </div>
  )
}

function FilterMenu({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void
}) {
  const current = options.find((o) => o.value === value)
  return (
    <PullDownMenu
      label={label}
      value={value || '__all'}
      options={[{ value: '__all', label: `Tous (${label.toLowerCase()})` }, ...options]}
      onChange={(v) => onChange(v === '__all' ? '' : v)}
      className={cn('h-9 pl-3.5 pr-2.5 rounded-pill text-subhead font-semibold max-w-[60vw]', value ? 'bg-accent-fill text-white' : 'bg-fill text-label')}
    >
      <span className="truncate">{current ? current.label.replace(/\s*\(\d[\d\s]*\)$/, '') : label}</span>
      <ChevronDown size={15} strokeWidth={2.5} aria-hidden="true" />
    </PullDownMenu>
  )
}

// ─── Favourites (ordered by the user) ─────────────────────────────────────────
function FavoritesView() {
  const qc = useQueryClient()
  const { data = [], isLoading } = useQuery({ queryKey: ['iptv', 'favorites'], queryFn: iptvService.favorites })
  const [editing, setEditing] = useState(false)
  const open = useOpenChannel()
  const reorder = useMutation({
    mutationFn: iptvService.reorderFavorites,
    onMutate: async (ids) => {
      const byId = new Map(data.map((c) => [c.id, c]))
      qc.setQueryData(['iptv', 'favorites'], ids.map((id) => byId.get(id)!).filter(Boolean))
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['iptv'] }) },
  })
  const move = (i: number, d: -1 | 1) => {
    const ids = data.map((c) => c.id)
    const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    reorder.mutate(ids)
  }
  if (isLoading) return <div className={CHANNEL_GRID}>{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="w-full aspect-video rounded-card" />)}</div>
  if (!data.length) return <EmptyState icon={<Heart strokeWidth={1.25} />} title="Aucune chaîne favorite" message="Touche le cœur d’une chaîne pour la retrouver ici, dans l’ordre que tu veux." action={<Link to="/iptv/chaines" className="text-accent-text">Parcourir les chaînes</Link>} />
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="secondary" size="small" onClick={() => setEditing((e) => !e)}>{editing ? 'Terminé' : 'Organiser'}</Button>
      </div>
      {editing ? (
        <Group header="Ordre des favoris">
          {data.map((c, i) => (
            <ListRow key={c.id} title={c.name} icon={<ChannelLogo channel={c} className="w-12 h-8 rounded-[8px]" />}>
              <div className="flex gap-1 ml-auto">
                <button type="button" className="w-11 h-11 grid place-items-center rounded-full hoverable disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Monter ${c.name}`}><ChevronUp size={18} /></button>
                <button type="button" className="w-11 h-11 grid place-items-center rounded-full hoverable disabled:opacity-30" disabled={i === data.length - 1} onClick={() => move(i, 1)} aria-label={`Descendre ${c.name}`}><ChevronDown size={18} /></button>
              </div>
            </ListRow>
          ))}
        </Group>
      ) : (
        <ul className={CHANNEL_GRID}>{data.map((c) => <li key={c.id}><ChannelTile channel={c} onOpen={(ch) => open(ch, data)} /></li>)}</ul>
      )}
    </div>
  )
}

// ─── Countries / categories / languages ───────────────────────────────────────
function FacetView({ kind }: { kind: 'country' | 'category' | 'language' }) {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['iptv', 'facets'], queryFn: iptvService.facets, staleTime: 5 * 60_000 })
  const items = useMemo(() => {
    if (!data) return []
    const list = kind === 'country'
      ? data.countries.map((c) => ({ key: c.code, title: countryName(c.code, c.name), lead: c.flag ?? flag(c.code), count: c.count }))
      : kind === 'category'
        ? data.categories.map((c) => ({ key: c.id, title: categoryName(c.id, c.name), lead: undefined, count: c.count }))
        : data.languages.map((l) => ({ key: l.code, title: languageName(l.code, l.name), lead: undefined, count: l.count }))
    const t = text.trim().toLowerCase()
    return t ? list.filter((x) => x.title.toLowerCase().includes(t)) : list
  }, [data, kind, text])
  const param = kind === 'country' ? 'country' : kind === 'category' ? 'category' : 'language'
  if (isLoading) return <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-group" />)}</div>
  return (
    <div className="flex flex-col gap-4">
      {kind !== 'category' && <SearchField value={text} onChange={setText} label={kind === 'country' ? 'Rechercher un pays' : 'Rechercher une langue'} placeholder={kind === 'country' ? 'Rechercher un pays' : 'Rechercher une langue'} />}
      {items.length === 0 ? <EmptyState title="Rien à afficher" message="Le catalogue ne contient pas encore ces informations." /> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((x) => <FacetTile key={x.key} lead={x.lead} title={x.title} count={x.count} onClick={() => navigate(`/iptv/chaines?${param}=${encodeURIComponent(x.key)}`)} />)}
        </div>
      )}
    </div>
  )
}

// ─── Recently watched ────────────────────────────────────────────────────────
function RecentView() {
  const { data = [], isLoading } = useQuery({ queryKey: ['iptv', 'history'], queryFn: iptvService.history })
  const open = useOpenChannel()
  if (isLoading) return <div className={CHANNEL_GRID}>{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="w-full aspect-video rounded-card" />)}</div>
  if (!data.length) return <EmptyState icon={<History strokeWidth={1.25} />} title="Aucune chaîne regardée" message="Les chaînes que tu regardes apparaîtront ici." />
  return <ul className={CHANNEL_GRID}>{data.map((c) => <li key={c.id}><ChannelTile channel={c} onOpen={(ch) => open(ch, data)} /></li>)}</ul>
}

// ─── Settings ───────────────────────────────────────────────────────────────
function SettingsView() {
  const qc = useQueryClient()
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const { data } = useQuery({
    queryKey: ['iptv', 'settings'],
    queryFn: iptvService.settings,
    refetchInterval: (q) => (q.state.data?.refresh.running ? 3000 : false),
  })
  const [epg, setEpg] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: iptvService.saveSettings,
    onSuccess: () => { toast.success('Paramètres enregistrés'); void qc.invalidateQueries({ queryKey: ['iptv'] }) },
    onError: (e) => toast.error(serverError(e)),
  })
  const refresh = useRefresh()
  if (!data) return <Skeleton className="h-64 rounded-group" />
  const { settings, refresh: state } = data
  const at = state.at ? new Date(state.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais'
  return (
    <div className="flex flex-col gap-8 max-w-[680px]">
      <Group header="Catalogue" footer="Les chaînes viennent du dépôt public iptv-org. Une chaîne n’est marquée « disponible » qu’après une vérification réelle de son flux, faite peu à peu en arrière-plan (favoris et chaînes regardées d’abord).">
        <ListRow title="Mise à jour" detail={state.running ? 'en cours…' : at} status={state.ok === false ? 'error' : undefined} />
        {state.stats && <ListRow title="Chaînes" detail={(state.stats.imported ?? state.stats.channels ?? 0).toLocaleString('fr-FR')} />}
        {state.ok === false && state.message && <ListRow wrap title="Dernière erreur" subtitle={state.message} />}
        {state.notes?.length > 0 && <ListRow wrap title="Remarques" subtitle={state.notes.join(' · ')} />}
        {isAdmin && (
          <ListRow title="Actualiser maintenant">
            <Button size="small" loading={state.running || refresh.isPending} onClick={() => refresh.mutate()} icon={<RefreshCw size={14} />}>Actualiser</Button>
          </ListRow>
        )}
        {isAdmin && (
          <ListRow title="Actualisation quotidienne">
            <Toggle label="Actualisation quotidienne" checked={settings.autoRefresh} onChange={(v) => save.mutate({ autoRefresh: v })} />
          </ListRow>
        )}
      </Group>
      {isAdmin && (
        <Group header="Affichage">
          <ListRow wrap title="Masquer les indisponibles" subtitle="Celles dont la dernière vérification a échoué.">
            <Toggle label="Masquer les chaînes indisponibles" checked={settings.hideOffline} onChange={(v) => save.mutate({ hideOffline: v })} />
          </ListRow>
        </Group>
      )}
      <form
        onSubmit={(e) => { e.preventDefault(); if (isAdmin) save.mutate({ epgUrl: (epg ?? settings.epgUrl ?? '').trim() || null }) }}
      >
        <Group header="Guide TV (EPG)" footer="iptv-org ne publie pas de guide prêt à l’emploi. Indique l’adresse d’un fichier XMLTV (par exemple généré avec iptv-org/epg) : « Maintenant » et « Ensuite » s’afficheront alors dans le lecteur. Sans guide, aucun programme n’est affiché.">
          <div role="listitem" className="nx-row px-4 py-2">
            <TextField label="Adresse du guide XMLTV" hideLabel placeholder="https://…/guide.xml" value={epg ?? settings.epgUrl ?? ''} onChange={(e) => setEpg(e.target.value)} disabled={!isAdmin} inputMode="url" />
          </div>
        </Group>
        {isAdmin && <div className="flex justify-end pt-3"><Button type="submit" variant="primary" loading={save.isPending}>Enregistrer</Button></div>}
      </form>
    </div>
  )
}
