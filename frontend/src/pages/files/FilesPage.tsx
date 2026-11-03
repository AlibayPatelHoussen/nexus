import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ChevronRight, ChevronUp, FolderPlus, FilePlus,
  Upload, Download, Trash2, Edit2, Search,
  Grid, List, X, Folder,
  FileVideo, FileImage, FileCode2, FileCog, FileText, FileArchive,
  Eye, MoreVertical,
} from 'lucide-react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useConfirm } from '@/components/ui/useConfirm'
import { useFiles } from '@/hooks/useFiles'
import { filesService } from '@/services/filesService'
import { formatBytes, formatDate } from '@/utils'
import type { FileEntry } from '@/types'
import toast from 'react-hot-toast'
import { serverError, showError } from '@/utils/errorToast'

function FileIcon({ entry, size = 15 }: { entry: FileEntry; size?: number }) {
  const ext = entry.extension?.replace('.', '') || ''
  if (entry.type === 'directory')
    return <Folder size={size} style={{ color: 'var(--orange)' }} strokeWidth={1.8} />

  const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'webm']
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']
  const codeExts  = ['ts', 'tsx', 'js', 'jsx', 'py', 'sh', 'json', 'yaml', 'yml']
  const confExts  = ['conf', 'service', 'env', 'toml', 'ini', 'cfg']
  const archExts  = ['zip', 'tar', 'gz', 'rar', '7z']

  if (videoExts.includes(ext)) return <FileVideo   size={size} style={{ color: 'var(--red)'    }} strokeWidth={1.8} />
  if (imageExts.includes(ext)) return <FileImage   size={size} style={{ color: 'var(--teal)'   }} strokeWidth={1.8} />
  if (codeExts.includes(ext))  return <FileCode2   size={size} style={{ color: 'var(--blue)'   }} strokeWidth={1.8} />
  if (confExts.includes(ext))  return <FileCog     size={size} style={{ color: 'var(--yellow)' }} strokeWidth={1.8} />
  if (archExts.includes(ext))  return <FileArchive size={size} style={{ color: 'var(--purple)' }} strokeWidth={1.8} />
  return <FileText size={size} style={{ color: 'var(--text3)' }} strokeWidth={1.8} />
}

function Modal({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <div
        className="card p-5 w-full max-w-sm animate-fade-up"
        style={{ boxShadow: 'var(--shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[14px] font-semibold mb-4" style={{ color: 'var(--text)' }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

function EditorModal({ entry, onClose }: { entry: FileEntry; onClose: () => void }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)

  useState(() => {
    filesService.readFile(entry.path)
      .then((c) => { setContent(c); setLoading(false) })
      .catch((err) => { showError('Lecture impossible', serverError(err)); onClose() })
  })

  async function save() {
    setSaving(true)
    try {
      await filesService.writeFile(entry.path, content)
      toast.success('Sauvegardé')
      onClose()
    } catch (err) { showError('Enregistrement impossible', serverError(err)) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="card flex flex-col w-full max-w-4xl animate-fade-up h-[100dvh] sm:h-[82vh] !rounded-none sm:!rounded-[14px]"
        style={{ boxShadow: 'var(--shadow-lg)' }}>
        <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-3 border-b"
          style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 min-w-0">
            <FileIcon entry={entry} size={13} />
            <span className="text-[12.5px] font-mono font-semibold truncate" title={entry.path} style={{ color: 'var(--text)' }}>
              {entry.path}
            </span>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button className="btn-primary text-[12px]" onClick={save} disabled={saving || loading}>
              {saving ? 'Sauvegarde…' : 'Sauvegarder'}
            </button>
            <button className="btn-ghost text-[12px]" onClick={onClose}>
              <X size={13} strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full" style={{ color: 'var(--text3)' }}>
              Chargement…
            </div>
          ) : (
            <textarea
              className="w-full h-full p-3 sm:p-4 resize-none outline-none terminal-font text-[13px] sm:text-[12.5px]"
              style={{ background: 'var(--bg)', color: 'var(--text)', border: 'none', lineHeight: '1.7' }}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
            />
          )}
        </div>
      </div>
    </div>
  )
}

interface CtxMenu { x: number; y: number; entry: FileEntry }

// Checkbox · name · size · [modified · permissions on md+] · actions
const LIST_COLS = 'grid grid-cols-[18px_minmax(0,1fr)_72px_28px] md:grid-cols-[18px_minmax(0,1fr)_110px_150px_90px_28px]'

const EDITABLE_EXTS = ['.txt', '.md', '.json', '.yaml', '.yml', '.conf',
  '.service', '.env', '.sh', '.py', '.ts', '.tsx', '.js', '.jsx',
  '.toml', '.ini', '.cfg', '.log', '.sql', '.css', '.html']

/**
 * Open a URL that needs an async stream token. The tab is opened
 * synchronously (inside the click) so popup blockers allow it.
 */
function openInNewTab(urlPromise: Promise<string>) {
  const tab = window.open('about:blank', '_blank')
  urlPromise
    .then((url) => {
      if (tab) tab.location.href = url
      else window.location.href = url
    })
    .catch(() => {
      tab?.close()
      toast.error("Impossible d'ouvrir le fichier")
    })
}

export default function FilesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlPath = searchParams.get('path') || '/'

  const {
    currentPath, entries, isLoading, breadcrumbs,
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

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')
  const [search,   setSearch]   = useState('')
  const [renaming, setRenaming] = useState<FileEntry | null>(null)
  const [creating, setCreating] = useState<'file' | 'dir' | null>(null)
  const [editing,  setEditing]  = useState<FileEntry | null>(null)
  const [ctxMenu,  setCtxMenu]  = useState<CtxMenu | null>(null)
  const [newName,  setNewName]  = useState('')
  const [newItem,  setNewItem]  = useState('')
  const uploadRef = useRef<HTMLInputElement>(null)

  const filtered = entries.filter((e) =>
    e.name.toLowerCase().includes(search.toLowerCase()))

  const confirm = useConfirm()

  async function confirmDelete(entry: FileEntry) {
    const isDir = entry.type === 'directory'
    const ok = await confirm({
      title: `Supprimer « ${entry.name} » ?`,
      message: isDir
        ? 'Le dossier et tout son contenu seront définitivement supprimés du serveur.'
        : 'Le fichier sera définitivement supprimé du serveur.',
      details: [entry.path],
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (ok) deleteEntry(entry.path)
  }

  // On touch screens a single tap opens (no double-click / right-click)
  const isTouch = useMediaQuery('(pointer: coarse)')

  function openMenuAt(el: HTMLElement, entry: FileEntry) {
    const r = el.getBoundingClientRect()
    setCtxMenu({ x: r.right - 180, y: r.bottom + 4, entry })
  }

  function handleOpen(entry: FileEntry) {
    if (entry.type === 'directory') return navigate(entry.path)
    const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm']
    if (videoExts.includes(entry.extension || '')) {
      openInNewTab(filesService.getStreamUrl(entry.path))
    } else if (EDITABLE_EXTS.includes(entry.extension || '')) {
      setEditing(entry)
    } else {
      openInNewTab(filesService.getDownloadUrl(entry.path))
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return
    const id = toast.loading(`Upload ${Array.from(files).length} fichier(s)…`)
    try {
      await filesService.upload(currentPath, Array.from(files))
      toast.success('Upload terminé', { id })
    } catch (err) { toast.dismiss(id); showError('Upload impossible', serverError(err)) }
    finally { invalidate() }
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)' }}>

      {/* TOPBAR */}
      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-5 py-2.5 sm:py-3 border-b"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>

        {/* Breadcrumbs — full row on mobile */}
        <div className="flex items-center gap-0.5 basis-full md:basis-auto flex-1 min-w-0 overflow-x-auto">
          {breadcrumbs.map((c, i) => (
            <div key={c.path} className="flex items-center gap-0.5 flex-shrink-0">
              {i > 0 && <ChevronRight size={12} style={{ color: 'var(--text3)' }} />}
              <button
                className="px-1.5 py-0.5 rounded text-[12px] font-mono transition-colors hover:bg-[var(--surface2)]"
                style={{ color: i === breadcrumbs.length - 1 ? 'var(--text)' : 'var(--text3)', fontWeight: i === breadcrumbs.length - 1 ? 600 : 400 }}
                onClick={() => navigate(c.path)}
              >{c.label}</button>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 md:flex-none min-w-[120px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text3)' }} />
          <input className="input pl-7 pr-3 py-1.5 text-[16px] sm:text-[12px] w-full md:w-44" placeholder="Rechercher…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setSearch('')}>
            <X size={11} style={{ color: 'var(--text3)' }} /></button>}
        </div>

        {/* Buttons */}
        <button className="btn-ghost text-[12px] px-2.5 py-1.5" onClick={goUp} aria-label="Dossier parent" title="Dossier parent"><ChevronUp size={13} strokeWidth={2} /></button>
        <button className="btn-ghost text-[12px] px-2.5 sm:px-4" onClick={() => { setCreating('dir'); setNewItem('') }} aria-label="Nouveau dossier" title="Nouveau dossier"><FolderPlus size={13} strokeWidth={2} /> <span className="hidden sm:inline">Dossier</span></button>
        <button className="btn-ghost text-[12px] px-2.5 sm:px-4" onClick={() => { setCreating('file'); setNewItem('') }} aria-label="Nouveau fichier" title="Nouveau fichier"><FilePlus size={13} strokeWidth={2} /> <span className="hidden sm:inline">Fichier</span></button>
        <button className="btn-ghost text-[12px] px-2.5 sm:px-4" onClick={() => uploadRef.current?.click()} aria-label="Upload" title="Upload"><Upload size={13} strokeWidth={2} /> <span className="hidden sm:inline">Upload</span></button>
        {selected.size > 0 && (
          <button className="btn-danger text-[12px]" disabled={deleting} onClick={async () => {
            const paths = [...selected]
            const ok = await confirm({
              title: `Supprimer ${paths.length} élément(s) ?`,
              message: 'Ils seront définitivement supprimés du serveur, dossiers compris avec tout leur contenu.',
              details: paths.map((p) => p.split('/').pop() || p),
              confirmLabel: 'Supprimer',
              danger: true,
            })
            if (ok) { deleteEntries(paths); clearSelect() }
          }} aria-label="Supprimer la sélection"><Trash2 size={13} strokeWidth={2} /> ({selected.size})</button>
        )}
        <button className="btn-ghost text-[12px] px-2.5 py-1.5"
          aria-label={viewMode === 'list' ? 'Vue grille' : 'Vue liste'}
          onClick={() => setViewMode(v => v === 'list' ? 'grid' : 'list')}>
          {viewMode === 'list' ? <Grid size={13} strokeWidth={2} /> : <List size={13} strokeWidth={2} />}
        </button>
      </div>

      {/* CONTENT */}
      <div className="flex-1 overflow-y-auto p-2 sm:p-4">
        {isLoading ? (
          <div className="flex justify-center items-center h-40">
            <div className="w-5 h-5 border-2 rounded-full animate-spin"
              style={{ borderColor: 'var(--border2)', borderTopColor: 'var(--blue)' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <Folder size={32} style={{ color: 'var(--text3)' }} strokeWidth={1.5} />
            <p className="text-[13px]" style={{ color: 'var(--text3)' }}>
              {search ? 'Aucun résultat' : 'Dossier vide'}
            </p>
          </div>
        ) : viewMode === 'list' ? (
          <div className="card overflow-hidden">
            <div className={`${LIST_COLS} gap-x-2 px-3 sm:px-4 py-2 border-b text-[11px] font-semibold uppercase tracking-wide`}
              style={{ borderColor: 'var(--border)', background: 'var(--surface2)', color: 'var(--text3)' }}>
              <input type="checkbox" className="w-3.5 h-3.5 cursor-pointer"
                checked={selected.size === filtered.length && filtered.length > 0}
                onChange={(e) => e.target.checked ? selectAll() : clearSelect()} />
              <span>Nom</span><span>Taille</span>
              <span className="hidden md:block">Modifié</span>
              <span className="hidden md:block">Permissions</span>
              <span />
            </div>
            {filtered.map((entry) => (
              <div key={entry.path}
                className={`${LIST_COLS} gap-x-2 items-center px-3 sm:px-4 py-2.5 sm:py-2 border-b cursor-pointer transition-colors`}
                style={{
                  borderColor: 'var(--border)',
                  background: selected.has(entry.path) ? 'var(--blue-dim)' : 'transparent',
                }}
                onMouseEnter={(e) => { if (!selected.has(entry.path)) e.currentTarget.style.background = 'var(--surface2)' }}
                onMouseLeave={(e) => { if (!selected.has(entry.path)) e.currentTarget.style.background = 'transparent' }}
                onDoubleClick={() => handleOpen(entry)}
                onClick={() => { if (isTouch) handleOpen(entry) }}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, entry }) }}
              >
                <input type="checkbox" className="w-4 h-4 sm:w-3.5 sm:h-3.5 cursor-pointer"
                  checked={selected.has(entry.path)}
                  onChange={() => toggleSelect(entry.path)}
                  onClick={(e) => e.stopPropagation()} />
                <div className="flex items-center gap-2 min-w-0">
                  <FileIcon entry={entry} />
                  <span className="text-[13px] truncate" style={{ color: 'var(--text)' }}>{entry.name}</span>
                </div>
                <span className="text-[11.5px] font-mono truncate" style={{ color: 'var(--text3)' }}>
                  {entry.size != null ? formatBytes(entry.size) : '—'}
                </span>
                <span className="hidden md:block text-[11.5px] truncate" style={{ color: 'var(--text3)' }}>{formatDate(entry.modified)}</span>
                <span className="hidden md:block text-[11px] font-mono" style={{ color: 'var(--text3)' }}>{entry.permissions}</span>
                <button
                  className="w-7 h-7 -mr-1 rounded-md flex items-center justify-center hover:bg-[var(--surface3)]"
                  style={{ color: 'var(--text3)' }}
                  aria-label={`Actions pour ${entry.name}`}
                  onClick={(e) => { e.stopPropagation(); openMenuAt(e.currentTarget, entry) }}
                >
                  <MoreVertical size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
            {filtered.map((entry) => (
              <div key={entry.path}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl cursor-pointer transition-all text-center"
                style={{
                  background: selected.has(entry.path) ? 'var(--blue-dim)' : 'transparent',
                  border: `1px solid ${selected.has(entry.path) ? 'var(--blue)' : 'transparent'}`,
                }}
                onMouseEnter={(e) => { if (!selected.has(entry.path)) e.currentTarget.style.background = 'var(--surface2)' }}
                onMouseLeave={(e) => { if (!selected.has(entry.path)) e.currentTarget.style.background = 'transparent' }}
                onDoubleClick={() => handleOpen(entry)}
                onClick={() => (isTouch ? handleOpen(entry) : toggleSelect(entry.path))}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, entry }) }}
              >
                <FileIcon entry={entry} size={30} />
                <span className="text-[11px] font-medium w-full truncate" style={{ color: 'var(--text)' }}>{entry.name}</span>
                {entry.size != null && <span className="text-[9.5px] font-mono" style={{ color: 'var(--text3)' }}>{formatBytes(entry.size)}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* STATUS BAR */}
      <div className="flex items-center justify-between gap-3 px-3 sm:px-5 py-1.5 border-t text-[11px] font-mono"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text3)', paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}>
        <span className="flex-shrink-0">{filtered.length} élément(s)</span>
        <span className="hidden sm:block truncate max-w-sm">{currentPath}</span>
        {selected.size > 0 && <span>{selected.size} sélectionné(s)</span>}
      </div>

      {/* CONTEXT MENU */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />
          <div className="fixed z-50 card py-1 min-w-[180px]"
            style={{
              top:  Math.max(8, Math.min(ctxMenu.y, window.innerHeight - 230)),
              left: Math.max(8, Math.min(ctxMenu.x, window.innerWidth - 190)),
              boxShadow: 'var(--shadow-lg)',
            }}>
            {[
              { icon: <Eye size={13} />, label: 'Ouvrir', action: () => { handleOpen(ctxMenu.entry); setCtxMenu(null) } },
              EDITABLE_EXTS.includes(ctxMenu.entry.extension || '') && {
                icon: <Edit2 size={13} />, label: 'Éditer',
                action: () => { setEditing(ctxMenu.entry); setCtxMenu(null) },
              },
              { icon: <Download size={13} />, label: 'Télécharger',
                action: () => { openInNewTab(filesService.getDownloadUrl(ctxMenu.entry.path)); setCtxMenu(null) } },
              { icon: <Edit2 size={13} />, label: 'Renommer',
                action: () => { setRenaming(ctxMenu.entry); setNewName(ctxMenu.entry.name); setCtxMenu(null) } },
              { icon: <Trash2 size={13} />, label: 'Supprimer', danger: true,
                action: () => { const entry = ctxMenu.entry; setCtxMenu(null); confirmDelete(entry) } },
            ].filter((x): x is { icon: React.ReactElement; label: string; action: () => void; danger?: boolean } => Boolean(x)).map((item) => (
              <button key={item.label}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 sm:py-2 text-[13px] sm:text-[12.5px] text-left transition-colors"
                style={{ color: item.danger ? 'var(--red)' : 'var(--text)' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                onClick={item.action}>
                <span style={{ color: item.danger ? 'var(--red)' : 'var(--text3)' }}>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* RENAME MODAL */}
      {renaming && (
        <Modal title="Renommer" onClose={() => setRenaming(null)}>
          <input className="input mb-4" value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (renameEntry({ path: renaming.path, newName }), setRenaming(null))}
            autoFocus />
          <div className="flex gap-2 justify-end">
            <button className="btn-ghost" onClick={() => setRenaming(null)}>Annuler</button>
            <button className="btn-primary" onClick={() => { renameEntry({ path: renaming.path, newName }); setRenaming(null) }}>
              Renommer
            </button>
          </div>
        </Modal>
      )}

      {/* CREATE MODAL */}
      {creating && (
        <Modal title={creating === 'dir' ? 'Nouveau dossier' : 'Nouveau fichier'} onClose={() => setCreating(null)}>
          <input className="input mb-4" placeholder={creating === 'dir' ? 'mon-dossier' : 'fichier.txt'}
            value={newItem} onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && newItem && (creating === 'dir' ? createDir(newItem) : createFile(newItem), setCreating(null))}
            autoFocus />
          <div className="flex gap-2 justify-end">
            <button className="btn-ghost" onClick={() => setCreating(null)}>Annuler</button>
            <button className="btn-primary" disabled={!newItem}
              onClick={() => { newItem && (creating === 'dir' ? createDir(newItem) : createFile(newItem)); setCreating(null) }}>
              Créer
            </button>
          </div>
        </Modal>
      )}

      {/* EDITOR */}
      {editing && <EditorModal entry={editing} onClose={() => setEditing(null)} />}

      <input ref={uploadRef} type="file" multiple className="hidden"
        onChange={(e) => handleUpload(e.target.files)} />
    </div>
  )
}
