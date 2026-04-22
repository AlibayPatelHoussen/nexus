import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { filesService } from '@/services/filesService'
import toast from 'react-hot-toast'

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
    onSuccess:  () => { invalidate(); toast.success('Supprimé') },
    onError:    () => toast.error('Erreur lors de la suppression'),
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
    renameEntry:  renameMut.mutate,
    createDir:    createDirMut.mutate,
    createFile:   createFileMut.mutate,
    invalidate,
  }
}
