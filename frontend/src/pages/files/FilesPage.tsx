import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ChevronRight, ChevronUp, Download, Ellipsis, Eye, FileArchive, FileCode2, FileImage, FilePlus,
  CircleCheck, FileText, FileVideo, Folder, FolderPlus, LayoutGrid, List, Pencil, Trash2, Upload,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useConfirm } from '@/components/ui/useConfirm'
import { useContextMenu } from '@/components/ui/useContextMenu'
import type { MenuItem } from '@/components/ui/ContextMenu'
import { useFiles } from '@/hooks/useFiles'
import { filesService } from '@/services/filesService'
import { cn, formatBytes, formatDate } from '@/utils'
import type { FileEntry } from '@/types'
import { serverError, showError } from '@/utils/errorToast'
import Page from '@/components/shell/Page'
import { useShell } from '@/components/shell/shellContext'
import SegmentedControl from '@/components/ui/SegmentedControl'
import Button from '@/components/ui/Button'
import Sheet from '@/components/ui/Sheet'
import TextField from '@/components/ui/TextField'
import SearchField from '@/components/ui/SearchField'
import EmptyState from '@/components/ui/EmptyState'
import Spinner from '@/components/ui/Spinner'
import { SkeletonRows } from '@/components/ui/Skeleton'

const EDITABLE_EXTS = ['.txt', '.md', '.json', '.yaml', '.yml', '.conf',
  '.service', '.env', '.sh', '.py', '.ts', '.tsx', '.js', '.jsx',
  '.toml', '.ini', '.cfg', '.log', '.sql', '.css', '.html']
const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.webm']

/** Folders in the accent colour (like Finder), files in grey whatever their type. */
function FileIcon({ entry, size = 16 }: { entry: FileEntry; size?: number }) {
  if (entry.type === 'directory') {
    return <Folder size={size} strokeWidth={1.5} className="text-accent flex-shrink-0" fill="var(--accent-soft)" aria-hidden="true" />
  }
  const ext = (entry.extension || '').replace('.', '')
  const Icon = ['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext) ? FileVideo
    : ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext) ? FileImage
    : ['ts', 'tsx', 'js', 'jsx', 'py', 'sh', 'json', 'yaml', 'yml', 'conf', 'service', 'env', 'toml', 'ini', 'cfg'].includes(ext) ? FileCode2
    : ['zip', 'tar', 'gz', 'rar', '7z', 'cbz'].includes(ext) ? FileArchive
    : FileText
  return <Icon size={size} strokeWidth={1.5} className="text-label2 flex-shrink-0" aria-hidden="true" />
}

/**
 * Open a URL that needs an async stream token. The tab is opened
 * synchronously (inside the click) so popup blockers allow it.
 */
function openInNewTab(urlPromise: Promise<string>) {
  const tab = window.open('about:blank', '_blank')
  urlPromise
    .then((url) => { if (tab) tab.location.href = url; else window.location.href = url })
    .catch(() => { tab?.close(); toast.error('Impossible d’ouvrir le fichier') })
}

const parentOf = (p: string) => p.split('/').slice(0, -1).join('/') || '/'
const nameOf = (p: string) => (p === '/' ? 'Racine' : p.split('/').filter(Boolean).pop() ?? p)
const VIEW_KEY = 'nexus-files-view'

export default function FilesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlPath = searchParams.get('path') || '/'
  const { device } = useShell()
  const phone = device === 'phone'
  const confirm = useConfirm()
  const menu = useContextMenu()

  const {
    currentPath, entries, isLoading, error, breadcrumbs,
    selected, navigate, goUp,
    toggleSelect, selectAll, clearSelect,
    deleteEntry, deleteEntries, deleting, renameEntry, createDir, createFile, invalidate,
  } = useFiles(urlPath)

  // Keep the current folder in the URL (?path=…): reload, share and Back work
  useEffect(() => {
    if (currentPath !== urlPath) setSearchParams({ path: currentPath })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath])
  useEffect(() => {
    if (urlPath !== currentPath) navigate(urlPath)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlPath])

  const [view, setViewRaw] = useState<'list' | 'icons'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'icons' ? 'icons' : 'list' } catch { return 'list' } })
  const setView = (v: 'list' | 'icons') => { setViewRaw(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode */ } }
  const [search, setSearch] = useState('')
  const [renaming, setRenaming] = useState<FileEntry | null>(null)
  const [creating, setCreating] = useState<'file' | 'dir' | null>(null)
  const [editing, setEditing] = useState<FileEntry | null>(null)
  const [selecting, setSelecting] = useState(false)   // phone selection mode
  const [uploading, setUploading] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setSearch(''); setSelecting(false) }, [currentPath])

  const filtered = useMemo(() => entries.filter((e) => e.name.toLowerCase().includes(search.toLowerCase())), [entries, search])

  async function confirmDelete(entry: FileEntry) {
    const isDir = entry.type === 'directory'
    const ok = await confirm({
      title: `Supprimer « ${entry.name} » ?`,
      message: isDir ? 'Le dossier et tout son contenu seront définitivement supprimés du serveur.' : 'Le fichier sera définitivement supprimé du serveur.',
      details: [entry.path],
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (ok) deleteEntry(entry.path)
  }

  async function deleteSelection() {
    const paths = [...selected]
    const ok = await confirm({
      title: `Supprimer ${paths.length} élément(s) ?`,
      message: 'Ils seront définitivement supprimés du serveur, dossiers compris avec tout leur contenu.',
      details: paths.map((p) => p.split('/').pop() || p),
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (ok) { deleteEntries(paths); clearSelect(); setSelecting(false) }
  }

  function open(entry: FileEntry) {
    if (entry.type === 'directory') return navigate(entry.path)
    if (VIDEO_EXTS.includes(entry.extension || '')) openInNewTab(filesService.getStreamUrl(entry.path))
    else if (EDITABLE_EXTS.includes(entry.extension || '')) setEditing(entry)
    else openInNewTab(filesService.getDownloadUrl(entry.path))
  }

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    const n = files.length
    const id = toast.loading(`Envoi de ${n} fichier${n > 1 ? 's' : ''}…`)
    try {
      await filesService.upload(currentPath, Array.from(files))
      toast.success(`${n} fichier${n > 1 ? 's' : ''} envoyé${n > 1 ? 's' : ''}`, { id })
    } catch (err) { toast.dismiss(id); showError('Envoi impossible', serverError(err)) }
    finally { setUploading(false); invalidate(); if (uploadRef.current) uploadRef.current.value = '' }
  }

  const itemsFor = (entry: FileEntry): MenuItem[] => [
    { label: entry.type === 'directory' ? 'Ouvrir' : 'Ouvrir', icon: <Eye />, shortcut: '↩', onSelect: () => open(entry) },
    ...(EDITABLE_EXTS.includes(entry.extension || '') ? [{ label: 'Modifier', icon: <Pencil />, onSelect: () => setEditing(entry) }] : []),
    ...(entry.type === 'file' ? [{ label: 'Télécharger', icon: <Download />, onSelect: () => openInNewTab(filesService.getDownloadUrl(entry.path)) }] : []),
    { label: 'Renommer…', icon: <Pencil />, onSelect: () => setRenaming(entry) },
    { separator: true },
    { label: 'Supprimer…', icon: <Trash2 />, destructive: true, onSelect: () => confirmDelete(entry) },
  ]

  // Finder-like selection: click = this one, ⌘/Ctrl-click = add / remove
  function select(entry: FileEntry, e: React.MouseEvent) {
    if (e.metaKey || e.ctrlKey) { toggleSelect(entry.path); return }
    clearSelect(); toggleSelect(entry.path)
  }

  // Keyboard: ⌘A, Delete, Enter, Escape
  useEffect(() => {
    if (phone) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [role="dialog"], [role="alertdialog"], [role="menu"]')) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll() }
      else if ((e.key === 'Delete' || (e.metaKey && e.key === 'Backspace')) && selected.size) { e.preventDefault(); void deleteSelection() }
      else if (e.key === 'Escape') clearSelect()
      else if (e.key === 'Enter' && selected.size === 1) { const en = entries.find((x) => selected.has(x.path)); if (en) open(en) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ── Chrome ─────────────────────────────────────────────────────────── */
  const iconBtn = 'w-8 h-8 grid place-items-center rounded-full text-label2 hoverable disabled:opacity-40'
  const searchField = (
    <SearchField value={search} onChange={setSearch} label="Rechercher dans ce dossier" className={phone ? 'w-full' : 'w-[180px]'} />
  )

  const desktopActions = (
    <>
      <button type="button" className={iconBtn} onClick={goUp} disabled={currentPath === '/'} aria-label="Dossier parent" title="Dossier parent"><ChevronUp size={18} strokeWidth={1.5} /></button>
      <SegmentedControl label="Présentation" value={view} onChange={setView} options={[
        { value: 'list', label: <List size={14} strokeWidth={1.75} aria-label="Liste" />, title: 'Liste' },
        { value: 'icons', label: <LayoutGrid size={14} strokeWidth={1.75} aria-label="Icônes" />, title: 'Icônes' },
      ]} />
      {selected.size > 0 && (
        <button type="button" className={cn(iconBtn, 'text-danger-text w-auto px-2 gap-1 flex items-center')} disabled={deleting} onClick={deleteSelection} aria-label="Supprimer la sélection" title="Supprimer la sélection">
          <Trash2 size={16} strokeWidth={1.5} /><span className="text-subhead tabular">{selected.size}</span>
        </button>
      )}
      <button type="button" className={iconBtn} onClick={() => setCreating('dir')} aria-label="Nouveau dossier" title="Nouveau dossier"><FolderPlus size={17} strokeWidth={1.5} /></button>
      <button type="button" className={iconBtn} onClick={() => setCreating('file')} aria-label="Nouveau fichier" title="Nouveau fichier"><FilePlus size={17} strokeWidth={1.5} /></button>
      <button type="button" className={iconBtn} onClick={() => uploadRef.current?.click()} disabled={uploading} aria-label="Envoyer des fichiers" title="Envoyer des fichiers">
        {uploading ? <Spinner size={16} /> : <Upload size={17} strokeWidth={1.5} />}
      </button>
      {searchField}
    </>
  )
  const phoneActions = selecting ? (
    <Button variant="plain" className="font-semibold text-[17px] min-h-[44px]" onClick={() => { setSelecting(false); clearSelect() }}>OK</Button>
  ) : (
    <button type="button" className="w-11 h-11 grid place-items-center text-accent-text active:opacity-50" aria-haspopup="menu" aria-label="Options du dossier"
      onClick={(e) => menu.openFrom(e.currentTarget, [
        { label: 'Nouveau dossier', icon: <FolderPlus />, onSelect: () => setCreating('dir') },
        { label: 'Nouveau fichier', icon: <FilePlus />, onSelect: () => setCreating('file') },
        { label: 'Envoyer des fichiers', icon: <Upload />, onSelect: () => uploadRef.current?.click() },
        { separator: true },
        { label: 'Sélectionner', icon: <CircleCheck />, onSelect: () => setSelecting(true) },
      ], nameOf(currentPath))}>
      <Ellipsis size={24} strokeWidth={1.75} />
    </button>
  )

  /* ── Content ────────────────────────────────────────────────────────── */
  let content: React.ReactNode
  if (isLoading) content = <SkeletonRows rows={6} />
  else if (error) content = <EmptyState tone="error" icon={<Folder strokeWidth={1.25} />} title="Dossier inaccessible" message={serverError(error)} action={<Button onClick={goUp}>Dossier parent</Button>} />
  else if (filtered.length === 0) content = <EmptyState icon={<Folder strokeWidth={1.25} />} title={search ? 'Aucun résultat' : 'Dossier vide'} message={search ? `Aucun élément ne contient « ${search} ».` : 'Envoie des fichiers ou crée un dossier.'} />
  else if (phone) {
    content = (
      <div className="bg-surface rounded-group overflow-hidden" role="list" aria-label={`Contenu de ${nameOf(currentPath)}`}>
        {filtered.map((entry, i) => {
          const on = selected.has(entry.path)
          return (
            <button
              key={entry.path}
              type="button"
              role="listitem"
              className={cn('relative w-full flex items-center gap-3 pl-4 pr-3 min-h-[60px] text-left pressable', i > 0 && 'hairline-t')}
              onClick={() => (selecting ? toggleSelect(entry.path) : open(entry))}
              {...menu.bind(itemsFor(entry), entry.name)}
              aria-pressed={selecting ? on : undefined}
            >
              {selecting && (
                <span className={cn('w-[22px] h-[22px] rounded-full grid place-items-center flex-shrink-0', on ? 'bg-accent text-white' : 'border-[1.5px] border-label3')} aria-hidden="true">
                  {on && <span className="text-[13px] font-bold">✓</span>}
                </span>
              )}
              <FileIcon entry={entry} size={30} />
              <span className="flex-1 min-w-0">
                <span className="block text-[17px] text-label truncate">{entry.name}</span>
                <span className="block text-[13px] text-label2 truncate tabular">{formatDate(entry.modified)}{entry.size != null ? ` · ${formatBytes(entry.size)}` : ''}</span>
              </span>
              {entry.type === 'directory' && !selecting && <ChevronRight size={16} strokeWidth={2} className="text-label3 flex-shrink-0" aria-hidden="true" />}
            </button>
          )
        })}
      </div>
    )
  } else if (view === 'icons') {
    content = (
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(104px,1fr))]" role="list" onClick={(e) => { if (e.target === e.currentTarget) clearSelect() }}>
        {filtered.map((entry) => {
          const on = selected.has(entry.path)
          return (
            <button
              key={entry.path}
              type="button"
              role="listitem"
              className="flex flex-col items-center gap-1.5 p-2 rounded-[8px] text-center outline-none focus-visible:ring-2 focus-visible:ring-accent"
              onClick={(e) => select(entry, e)}
              onDoubleClick={() => open(entry)}
              {...menu.bind(itemsFor(entry), entry.name)}
              aria-pressed={on}
              aria-label={entry.name}
            >
              <span className={cn('p-2 rounded-[8px]', on && 'bg-fill')}><FileIcon entry={entry} size={44} /></span>
              <span className={cn('text-subhead w-full px-1 rounded-[4px] line-clamp-2 break-all', on ? 'bg-accent text-white' : 'text-label')}>{entry.name}</span>
            </button>
          )
        })}
      </div>
    )
  } else {
    content = (
      <div className="bg-surface rounded-card overflow-hidden">
        <table className="w-full text-body border-collapse table-fixed" aria-label={`Contenu de ${nameOf(currentPath)}`}>
          <thead className="hairline-b">
            <tr className="text-caption text-label2 text-left">
              <th scope="col" className="font-normal pl-4 h-7">Nom</th>
              <th scope="col" className="font-normal w-[190px] max-lg:w-[150px] px-2">Date de modification</th>
              <th scope="col" className="font-normal w-[96px] px-2 text-right">Taille</th>
              <th scope="col" className="font-normal w-[96px] px-2 max-lg:hidden">Autorisations</th>
              <th scope="col" className="w-[40px]"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry, n) => {
              const on = selected.has(entry.path)
              const muted = on ? 'text-white/80' : 'text-label2'
              return (
                <tr
                  key={entry.path}
                  aria-selected={on}
                  tabIndex={0}
                  className={cn('h-[30px] outline-none', on ? 'bg-accent text-white' : n % 2 ? 'bg-fill2' : '', 'focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]')}
                  onClick={(e) => select(entry, e)}
                  onDoubleClick={() => open(entry)}
                  onKeyDown={(e) => { if (e.key === 'Enter') open(entry) }}
                  {...menu.bind(itemsFor(entry), entry.name)}
                >
                  <td className="pl-4 pr-2">
                    <span className="flex items-center gap-2 min-w-0">
                      {on && entry.type === 'directory' ? <Folder size={16} strokeWidth={1.5} className="text-white flex-shrink-0" aria-hidden="true" /> : <FileIcon entry={entry} />}
                      <span className="truncate">{entry.name}</span>
                    </span>
                  </td>
                  <td className={cn('px-2 truncate tabular', muted)}>{formatDate(entry.modified)}</td>
                  <td className={cn('px-2 text-right tabular', muted)}>{entry.size != null ? formatBytes(entry.size) : '—'}</td>
                  <td className={cn('px-2 font-mono text-subhead max-lg:hidden', muted)}>{entry.permissions}</td>
                  <td className="pr-2 text-right">
                    <button
                      type="button"
                      className={cn('w-6 h-6 inline-grid place-items-center rounded-[5px]', on ? 'text-white hover:bg-white/20' : 'text-label2 hover:bg-fill')}
                      aria-label={`Actions pour ${entry.name}`}
                      onClick={(e) => { e.stopPropagation(); menu.openFrom(e.currentTarget, itemsFor(entry), entry.name) }}
                    >
                      <Ellipsis size={15} strokeWidth={1.75} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  const status = `${filtered.length} élément${filtered.length > 1 ? 's' : ''}${selected.size ? `, ${selected.size} sélectionné${selected.size > 1 ? 's' : ''}` : ''}`

  return (
    <Page
      title={nameOf(currentPath)}
      subtitle={currentPath}
      back={phone && currentPath !== '/' ? { to: `/files?path=${encodeURIComponent(parentOf(currentPath))}`, label: nameOf(parentOf(currentPath)) } : undefined}
      actions={phone ? phoneActions : desktopActions}
      accessory={phone ? searchField : undefined}
    >
      <div className={cn('flex flex-col gap-3', phone && selecting && 'pb-24')}>
        {content}
        {!phone && (
          // Path bar + status (Finder)
          <div className="flex items-center justify-between gap-4 px-1 text-caption text-label2">
            <nav aria-label="Chemin" className="flex items-center gap-0.5 min-w-0 overflow-x-auto scrollbar-none">
              {breadcrumbs.map((c, i) => (
                <span key={c.path} className="flex items-center gap-0.5 flex-shrink-0">
                  {i > 0 && <ChevronRight size={11} strokeWidth={2} aria-hidden="true" />}
                  <Link to={`/files?path=${encodeURIComponent(c.path)}`} className={cn('flex items-center gap-1 px-1 rounded-[4px] hover:bg-fill', i === breadcrumbs.length - 1 && 'text-label')}>
                    <Folder size={11} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
                    {c.label === '/' ? 'Racine' : c.label}
                  </Link>
                </span>
              ))}
            </nav>
            <span className="flex-shrink-0 tabular" aria-live="polite">{status}</span>
          </div>
        )}
        {phone && !isLoading && <p className="text-center text-subhead text-label2 tabular">{status}</p>}
      </div>

      {/* Phone: selection toolbar */}
      {phone && selecting && (
        <div className="fixed inset-x-0 z-40 material-bar hairline-t flex items-center justify-between px-4" style={{ bottom: 'calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px))', height: 48 }}>
          <Button variant="plain" className="text-[17px]" onClick={() => (selected.size === filtered.length ? clearSelect() : selectAll())}>
            {selected.size === filtered.length ? 'Tout désélectionner' : 'Tout sélectionner'}
          </Button>
          <Button variant="destructive-plain" className="text-[17px]" disabled={!selected.size || deleting} onClick={deleteSelection} aria-label="Supprimer la sélection">
            Supprimer{selected.size ? ` (${selected.size})` : ''}
          </Button>
        </div>
      )}


      {menu.element}

      <NameSheet
        open={!!renaming}
        title="Renommer"
        label="Nouveau nom"
        initial={renaming?.name ?? ''}
        confirmLabel="Renommer"
        onClose={() => setRenaming(null)}
        onSubmit={(name) => { if (renaming) renameEntry({ path: renaming.path, newName: name }) }}
      />
      <NameSheet
        open={!!creating}
        title={creating === 'dir' ? 'Nouveau dossier' : 'Nouveau fichier'}
        label="Nom"
        initial={creating === 'dir' ? 'Nouveau dossier' : 'sans titre.txt'}
        confirmLabel="Créer"
        onClose={() => setCreating(null)}
        onSubmit={(name) => (creating === 'dir' ? createDir(name) : createFile(name))}
      />
      {editing && <Editor entry={editing} onClose={() => setEditing(null)} />}

      <input ref={uploadRef} type="file" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />
    </Page>
  )
}

/* ── Name sheet (create / rename) ─────────────────────────────────────── */

function NameSheet({ open, title, label, initial, confirmLabel, onClose, onSubmit }: {
  open: boolean; title: string; label: string; initial: string; confirmLabel: string
  onClose: () => void; onSubmit: (name: string) => void
}) {
  const [name, setName] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  const { device } = useShell()
  const phone = device === 'phone'
  useEffect(() => {
    if (!open) return
    setName(initial)
    // Select the name without its extension, like Finder
    setTimeout(() => { const el = input.current; if (!el) return; const dot = initial.lastIndexOf('.'); el.setSelectionRange(0, dot > 0 ? dot : initial.length) }, 60)
  }, [open, initial])
  const valid = name.trim() && !name.includes('/')
  const submit = () => { if (!valid) return; onSubmit(name.trim()); onClose() }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      initialFocus={input}
      phoneHeader={{ left: <Button variant="plain" onClick={onClose}>Annuler</Button>, right: <Button variant="plain" className="font-semibold" disabled={!valid} onClick={submit}>{confirmLabel}</Button> }}
      footer={phone ? undefined : <><Button onClick={onClose}>Annuler</Button><Button variant="primary" disabled={!valid} onClick={submit}>{confirmLabel}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); submit() }}>
        <TextField ref={input} label={label} hideLabel={phone} value={name} onChange={(e) => setName(e.target.value)}
          error={name.includes('/') ? 'Le nom ne peut pas contenir « / ».' : undefined} autoComplete="off" spellCheck={false} />
      </form>
    </Sheet>
  )
}

/* ── Text editor ──────────────────────────────────────────────────────── */

function Editor({ entry, onClose }: { entry: FileEntry; onClose: () => void }) {
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const confirm = useConfirm()

  useEffect(() => {
    filesService.readFile(entry.path)
      .then((c) => { setContent(c); setOriginal(c); setLoading(false) })
      .catch((err) => { showError('Lecture impossible', serverError(err)); onClose() })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.path])

  async function save() {
    setSaving(true)
    try {
      await filesService.writeFile(entry.path, content)
      toast.success('Enregistré')
      onClose()
    } catch (err) { showError('Enregistrement impossible', serverError(err)) }
    finally { setSaving(false) }
  }
  async function close() {
    if (content !== original && !(await confirm({ title: 'Ignorer les modifications ?', message: `Les changements apportés à « ${entry.name} » seront perdus.`, confirmLabel: 'Ignorer', danger: true }))) return
    onClose()
  }

  return (
    <Sheet
      open
      onClose={close}
      title={entry.name}
      size="lg"
      dismissible={!saving}
      phoneHeader={{ left: <Button variant="plain" onClick={close}>Annuler</Button>, right: <Button variant="plain" className="font-semibold" loading={saving} disabled={loading} onClick={save}>Enregistrer</Button> }}
      footer={<><span className="mr-auto text-caption text-label2 font-mono truncate max-md:hidden">{entry.path}</span><Button onClick={close} className="max-md:hidden">Annuler</Button><Button variant="primary" loading={saving} disabled={loading} onClick={save} className="max-md:hidden">Enregistrer</Button></>}
      className="md:h-[78vh] max-md:h-[92dvh]"
    >
      {loading ? <div className="grid place-items-center h-full min-h-[200px]"><Spinner /></div> : (
        <textarea
          className="w-full h-full min-h-[50vh] p-3 rounded-[8px] resize-none outline-none font-mono text-[13px] leading-relaxed text-label bg-surface2"
          style={{ boxShadow: 'inset 0 0 0 .5px var(--separator)' }}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          aria-label={`Contenu de ${entry.name}`}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save() } }}
        />
      )}
    </Sheet>
  )
}
