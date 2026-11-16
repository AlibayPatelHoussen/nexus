import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { droppedFiles, timeLeft, useUploads, type UploadJob } from './useUploads'

const job = (over: Partial<UploadJob>): UploadJob => ({ id: 'j', label: 'a.mkv', loaded: 0, total: 100, startedAt: 0, ...over })

describe('timeLeft', () => {
  it('says nothing at the start or at the end', () => {
    expect(timeLeft(job({ loaded: 10 }), 1000)).toBeNull()
    expect(timeLeft(job({ loaded: 100 }), 60_000)).toBeNull()
  })
  it('from the speed so far', () => {
    expect(timeLeft(job({ loaded: 50 }), 10_000)).toBe('moins d’une minute')          // 10 s left
    expect(timeLeft(job({ loaded: 10 }), 60_000)).toBe('9 min restantes')
    expect(timeLeft(job({ loaded: 1 }), 60_000)).toBe('1 h 39 min restantes')
  })
})

describe('droppedFiles', () => {
  const file = (name: string, dir = false) => ({
    kind: 'file', getAsFile: () => new File(['x'], name), webkitGetAsEntry: () => ({ isDirectory: dir }),
  })
  it('keeps the files, counts the folders', () => {
    const dt = { items: [file('a.jpg'), file('Vacances', true), { kind: 'string' }], files: [] } as unknown as DataTransfer
    const { files, folders } = droppedFiles(dt)
    expect(files.map((f) => f.name)).toEqual(['a.jpg'])
    expect(folders).toBe(1)
  })
})

describe('useUploads', () => {
  it('shows the progress, then forgets the job; « Annuler » gives null', async () => {
    const { result } = renderHook(() => useUploads())
    let progress: (l: number, t: number) => void = () => {}
    let finish: (v: string) => void = () => {}
    let sent: Promise<string | null> = Promise.resolve(null)
    act(() => {
      sent = result.current.run([new File(['abcd'], 'a.txt')], (p) => { progress = p; return new Promise<string>((r) => { finish = r }) })
    })
    expect(result.current.jobs).toMatchObject([{ label: 'a.txt', loaded: 0, total: 4 }])
    act(() => progress(4, 4))
    expect(result.current.jobs[0].loaded).toBe(4)
    await act(async () => { finish('ok'); expect(await sent).toBe('ok') })
    expect(result.current.jobs).toEqual([])

    let cancelled: Promise<string | null> = Promise.resolve('x')
    act(() => {
      cancelled = result.current.run([new File(['a'], 'b.txt'), new File(['b'], 'c.txt')], (_p, signal) => new Promise<string>((_r, reject) => {
        signal.addEventListener('abort', () => reject(new Error('canceled')))
      }))
    })
    expect(result.current.jobs[0].label).toBe('2 fichiers')
    act(() => result.current.cancel(result.current.jobs[0].id))
    await act(async () => { expect(await cancelled).toBeNull() })
    await waitFor(() => expect(result.current.jobs).toEqual([]))
  })
})
