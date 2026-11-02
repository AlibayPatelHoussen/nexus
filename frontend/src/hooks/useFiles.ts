import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { filesService } from '@/services/filesService'
import toast from 'react-hot-toast'
import { showError } from '@/utils/errorToast'
import { useOptionalConfirm } from '@/components/ui/useConfirm'

/** Error message sent by the server (falls back to a generic text). */
function serverError(err: unknown): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string }
  return e?.response?.data?.error || e?.message || 'erreur inconnue'
}

/** The server can force this deletion with the sudo password (permission problem in the library). */
function needsPassword(err: unknown): boolean {
  return (err as { response?: { data?: { code?: string } } })?.response?.data?.code === 'NEEDS_PASSWORD'
}

const baseName = (p: string) => p.split('/').filter(Boolean).pop() ?? p

export function useFiles(initialPath = '/') {
  const [currentPath, setCurrentPath] = useState(initialPath)
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const qc = useQueryClient()

  const { data: entries = [], isLoading, error } = useQuery({
    queryKey: ['files', currentPath],
    queryFn:  () => filesService.list(currentPath),
    staleTime: 5_000,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['files', currentPath] })
  const confirm = useOptionalConfirm()

  /**
   * Deletion refused for lack of rights: offer to force it with the server's
   * sudo password. Cancelled → the explanation with the chown command.
   */
  const forceDelete = async (paths: string[], reason: string) => {
    if (!confirm) { showError('Suppression impossible', reason); return }
    let result: Awaited<ReturnType<typeof filesService.deleteElevated>> | null = null
    const ok = await confirm({
      title:   paths.length > 1 ? `Forcer la suppression de ${paths.length} éléments ?` : `Forcer la suppression de « ${baseName(paths[0])} » ?`,
      message: 'Nexus n\'a pas les droits pour supprimer ' + (paths.length > 1 ? 'ces éléments' : 'cet élément') +
               ' (ils appartiennent à un autre utilisateur, souvent root). Entre le mot de passe du serveur ' +
               '(celui que tu utilises pour sudo) pour les supprimer quand même. Il n\'est pas enregistré.',
      details: paths,
      confirmLabel: 'Supprimer',
      danger:  true,
      password: {
        label:  'Mot de passe du serveur (sudo)',
        submit: async (password) => {
          try { result = await filesService.deleteElevated(paths, password); return null }
          catch (err) { return serverError(err) }
        },
      },
    })
    invalidate()
    if (!ok || !result) { showError('Suppression impossible', reason); return }
    const { deleted, failed } = result as Awaited<ReturnType<typeof filesService.deleteElevated>>
    if (deleted.length) toast.success(deleted.length > 1 ? `${deleted.length} élément(s) supprimé(s)` : 'Supprimé')
    if (failed.length) showError(`${failed.length} élément(s) non supprimé(s)`, failed[0].error)
  }

  // Navigate
  const navigate = useCallback((path: string) => {
    setCurrentPath(path)
    setSelected(new Set())
  }, [])

  const goUp = useCallback(() => {
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/'
    navigate(parent)
  }, [currentPath, navigate])

  // Breadcrumbs
  const breadcrumbs = currentPath
    .split('/')
    .filter(Boolean)
    .reduce<{ label: string; path: string }[]>(
      (acc, part) => {
        const prev = acc[acc.length - 1]?.path || ''
        acc.push({ label: part, path: `${prev}/${part}` })
        return acc
      },
      [{ label: '/', path: '/' }],
    )

  // Mutations
  const deleteMut = useMutation({
    mutationFn: (path: string) => filesService.delete(path),
    onSuccess:  () => toast.success('Supprimé'),
    onError:    (err, path) => {
      if (needsPassword(err)) void forceDelete([path], serverError(err))
      else showError('Suppression impossible', serverError(err))
    },
    onSettled:  () => invalidate(),
  })

  // Several entries at once: each failure is reported, none blocks the others
  const deleteManyMut = useMutation({
    mutationFn: (paths: string[]) => filesService.deleteMany(paths),
    onSuccess:  ({ deleted, failed }) => {
      if (deleted.length) toast.success(`${deleted.length} élément(s) supprimé(s)`)
      const forcible = failed.filter((f) => f.code === 'NEEDS_PASSWORD')
      const other    = failed.filter((f) => f.code !== 'NEEDS_PASSWORD')
      if (other.length) {
        showError(
          `${other.length} élément(s) non supprimé(s)` + (other.length > 1 ? ` — premier échec : ${baseName(other[0].path)}` : ''),
          other[0].error,
        )
      }
      if (forcible.length) void forceDelete(forcible.map((f) => f.path), forcible[0].error)
    },
    onError:    (err) => showError('Suppression impossible', serverError(err)),
    onSettled:  () => invalidate(),
  })

  const renameMut = useMutation({
    mutationFn: ({ path, newName }: { path: string; newName: string }) =>
      filesService.rename(path, newName),
    onSuccess:  () => { invalidate(); toast.success('Renommé') },
    onError:    () => toast.error('Erreur lors du renommage'),
  })

  const createDirMut = useMutation({
    mutationFn: (name: string) =>
      filesService.createDir(`${currentPath}/${name}`.replace('//', '/')),
    onSuccess: () => { invalidate(); toast.success('Dossier créé') },
    onError:   () => toast.error('Erreur lors de la création'),
  })

  const createFileMut = useMutation({
    mutationFn: (name: string) =>
      filesService.createFile(`${currentPath}/${name}`.replace('//', '/')),
    onSuccess: () => { invalidate(); toast.success('Fichier créé') },
    onError:   () => toast.error('Erreur lors de la création'),
  })

  // Selection
  const toggleSelect = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  const selectAll  = () => setSelected(new Set(entries.map((e) => e.path)))
  const clearSelect = () => setSelected(new Set())

  return {
    currentPath,
    entries,
    isLoading,
    error,
    breadcrumbs,
    selected,
    navigate,
    goUp,
    toggleSelect,
    selectAll,
    clearSelect,
    deleteEntry:  deleteMut.mutate,
    deleteEntries: deleteManyMut.mutate,
    deleting:     deleteMut.isPending || deleteManyMut.isPending,
    renameEntry:  renameMut.mutate,
    createDir:    createDirMut.mutate,
    createFile:   createFileMut.mutate,
    invalidate,
  }
}
