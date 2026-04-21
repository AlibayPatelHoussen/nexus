import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFiles } from '@/hooks/useFiles'
import * as filesServiceModule from '@/services/filesService'

vi.mock('@/services/filesService', () => ({
  filesService: {
    list:       vi.fn(),
    delete:     vi.fn(),
    rename:     vi.fn(),
    createDir:  vi.fn(),
    createFile: vi.fn(),
  },
}))

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
)

describe('useFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(filesServiceModule.filesService.list as any).mockResolvedValue([])
  })

  it('initializes with root path', () => {
    const { result } = renderHook(() => useFiles('/'), { wrapper })
    expect(result.current.currentPath).toBe('/')
  })

  it('generates breadcrumbs', () => {
    const { result } = renderHook(() => useFiles('/media/films'), { wrapper })
    const labels = result.current.breadcrumbs.map((b) => b.label)
    expect(labels).toContain('/')
    expect(labels).toContain('media')
    expect(labels).toContain('films')
  })

  it('navigates to new path', () => {
    const { result } = renderHook(() => useFiles('/'), { wrapper })
    act(() => result.current.navigate('/media'))
    expect(result.current.currentPath).toBe('/media')
  })

  it('toggles selection', () => {
    const { result } = renderHook(() => useFiles('/'), { wrapper })
    act(() => result.current.toggleSelect('/media/films'))
    expect(result.current.selected.has('/media/films')).toBe(true)
    act(() => result.current.toggleSelect('/media/films'))
    expect(result.current.selected.has('/media/films')).toBe(false)
  })

  it('clears selection', () => {
    const { result } = renderHook(() => useFiles('/'), { wrapper })
    act(() => result.current.toggleSelect('/a'))
    act(() => result.current.toggleSelect('/b'))
    act(() => result.current.clearSelect())
    expect(result.current.selected.size).toBe(0)
  })
})
