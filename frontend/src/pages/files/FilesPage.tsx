import { useState, useRef } from 'react'
import {
  ChevronRight, ChevronUp, FolderPlus, FilePlus,
  Upload, Download, Trash2, Edit2, Search,
  Grid, List, X, Folder,
  FileVideo, FileImage, FileCode2, FileCog, FileText, FileArchive,
  Eye,
} from 'lucide-react'
import { useFiles } from '@/hooks/useFiles'
import { filesService } from '@/services/filesService'
import { formatBytes, formatDate } from '@/utils'
import type { FileEntry } from '@/types'
import toast from 'react-hot-toast'

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
      .catch(() => { toast.error('Impossible de lire'); onClose() })
  })

  async function save() {
    setSaving(true)
    try {
      await filesService.writeFile(entry.path, content)
      toast.success('Sauvegardé')
      onClose()
    } catch { toast.error('Erreur') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="card flex flex-col w-full max-w-4xl animate-fade-up"
        style={{ height: '82vh', boxShadow: 'var(--shadow-lg)' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <FileIcon entry={entry} size={13} />
            <span className="text-[12.5px] font-mono font-semibold" style={{ color: 'var(--text)' }}>
              {entry.path}
            </span>
          </div>
          <div className="flex gap-2">
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
              className="w-full h-full p-4 resize-none outline-none terminal-font text-[12.5px]"
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

const EDITABLE_EXTS = ['.txt', '.md', '.json', '.yaml', '.yml', '.conf',
  '.service', '.env', '.sh', '.py', '.ts', '.tsx', '.js', '.jsx',
  '.toml', '.ini', '.cfg', '.log', '.sql', '.css', '.html']

export default function FilesPage() {
  const {
    currentPath, entries, isLoading, breadcrumbs,
    selected, navigate, goUp,
    toggleSelect, selectAll, clearSelect,
    deleteEntry, renameEntry, createDir, createFile,
  } = useFiles('/')

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

  function handleOpen(entry: FileEntry) {
    if (entry.type === 'directory') return navigate(entry.path)
    const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm']
    if (videoExts.includes(entry.extension || '')) {
      window.open(filesService.getStreamUrl(entry.path), '_blank')
    } else if (EDITABLE_EXTS.includes(entry.extension || '')) {
      setEditing(entry)
    } else {
      window.open(filesService.getDownloadUrl(entry.path), '_blank')
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return
    const id = toast.loading(`Upload ${Array.from(files).length} fichier(s)…`)
    try {
      await filesService.upload(currentPath, Array.from(files))
      toast.success('Upload terminé', { id })
    } catch { toast.error('Erreur upload', { id }) }
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)' }}>

      {/* TOPBAR */}
      <div className="flex items-center gap-2 px-5 py-3 border-b"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto">
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
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text3)' }} />
          <input className="input pl-7 pr-3 py-1.5 text-[12px] w-44" placeholder="Rechercher…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setSearch('')}>
            <X size={11} style={{ color: 'var(--text3)' }} /></button>}
        </div>

        {/* Buttons */}
        <button className="btn-ghost text-[12px] px-2.5 py-1.5" onClick={goUp}><ChevronUp size={13} strokeWidth={2} /></button>
        <button className="btn-ghost text-[12px]" onClick={() => { setCreating('dir'); setNewItem('') }}><FolderPlus size={13} strokeWidth={2} /> Dossier</button>
        <button className="btn-ghost text-[12px]" onClick={() => { setCreating('file'); setNewItem('') }}><FilePlus size={13} strokeWidth={2} /> Fichier</button>
        <button className="btn-ghost text-[12px]" onClick={() => uploadRef.current?.click()}><Upload size={13} strokeWidth={2} /> Upload</button>
        {selected.size > 0 && (
          <button className="btn-danger text-[12px]" onClick={() => {
            if (confirm(`Supprimer ${selected.size} élément(s) ?`)) {
              selected.forEach((p) => deleteEntry(p)); clearSelect()
            }
          }}><Trash2 size={13} strokeWidth={2} /> ({selected.size})</button>
        )}
        <button className="btn-ghost text-[12px] px-2.5 py-1.5"
          onClick={() => setViewMode(v => v === 'list' ? 'grid' : 'list')}>
          {viewMode === 'list' ? <Grid size={13} strokeWidth={2} /> : <List size={13} strokeWidth={2} />}
        </button>
      </div>

      {/* CONTENT */}
      <div className="flex-1 overflow-y-auto p-4">
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
            <div className="grid px-4 py-2 border-b text-[11px] font-semibold uppercase tracking-wide"
              style={{ gridTemplateColumns: '18px 1fr 110px 150px 90px', borderColor: 'var(--border)', background: 'var(--surface2)', color: 'var(--text3)' }}>
              <input type="checkbox" className="w-3.5 h-3.5 cursor-pointer"
                checked={selected.size === filtered.length && filtered.length > 0}
                onChange={(e) => e.target.checked ? selectAll() : clearSelect()} />
              <span>Nom</span><span>Taille</span><span>Modifié</span><span>Permissions</span>
            </div>
            {filtered.map((entry) => (
              <div key={entry.path}
                className="grid items-center px-4 py-2 border-b cursor-pointer transition-colors"
                style={{
                  gridTemplateColumns: '18px 1fr 110px 150px 90px',
                  borderColor: 'var(--border)',
                  background: selected.has(entry.path) ? 'var(--blue-dim)' : 'transparent',
                }}
                onMouseEnter={(e) => { if (!selected.has(entry.path)) e.currentTarget.style.background = 'var(--surface2)' }}
                onMouseLeave={(e) => { if (!selected.has(entry.path)) e.currentTarget.style.background = 'transparent' }}
                onDoubleClick={() => handleOpen(entry)}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, entry }) }}
              >
                <input type="checkbox" className="w-3.5 h-3.5 cursor-pointer"
                  checked={selected.has(entry.path)}
                  onChange={() => toggleSelect(entry.path)}
                  onClick={(e) => e.stopPropagation()} />
                <div className="flex items-center gap-2 min-w-0">
                  <FileIcon entry={entry} />
                  <span className="text-[13px] truncate" style={{ color: 'var(--text)' }}>{entry.name}</span>
                </div>
                <span className="text-[11.5px] font-mono" style={{ color: 'var(--text3)' }}>
                  {entry.size != null ? formatBytes(entry.size) : '—'}
                </span>
                <span className="text-[11.5px]" style={{ color: 'var(--text3)' }}>{formatDate(entry.modified)}</span>
                <span className="text-[11px] font-mono" style={{ color: 'var(--text3)' }}>{entry.permissions}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
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
                onClick={() => toggleSelect(entry.path)}
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
      <div className="flex items-center justify-between px-5 py-1.5 border-t text-[11px] font-mono"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text3)' }}>
        <span>{filtered.length} élément(s)</span>
        <span className="truncate max-w-sm">{currentPath}</span>
        {selected.size > 0 && <span>{selected.size} sélectionné(s)</span>}
      </div>

      {/* CONTEXT MENU */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />
          <div className="fixed z-50 card py-1 min-w-[160px]"
            style={{ top: ctxMenu.y, left: ctxMenu.x, boxShadow: 'var(--shadow-lg)' }}>
            {[
              { icon: <Eye size={13} />, label: 'Ouvrir', action: () => { handleOpen(ctxMenu.entry); setCtxMenu(null) } },
              EDITABLE_EXTS.includes(ctxMenu.entry.extension || '') && {
                icon: <Edit2 size={13} />, label: 'Éditer',
                action: () => { setEditing(ctxMenu.entry); setCtxMenu(null) },
              },
              { icon: <Download size={13} />, label: 'Télécharger',
                action: () => { window.open(filesService.getDownloadUrl(ctxMenu.entry.path), '_blank'); setCtxMenu(null) } },
              { icon: <Edit2 size={13} />, label: 'Renommer',
                action: () => { setRenaming(ctxMenu.entry); setNewName(ctxMenu.entry.name); setCtxMenu(null) } },
              { icon: <Trash2 size={13} />, label: 'Supprimer', danger: true,
                action: () => { if (confirm(`Supprimer "${ctxMenu.entry.name}" ?`)) deleteEntry(ctxMenu.entry.path); setCtxMenu(null) } },
            ].filter(Boolean).map((item: any) => (
              <button key={item.label}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-[12.5px] text-left transition-colors"
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
