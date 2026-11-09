import { useEffect } from 'react'
import { create } from 'zustand'

/**
 * The library a page belongs to when its URL does not say it (a title page /media/… is
 * under Manga, Films, Animes…): the tab bar and the sidebar fall back on it to keep the
 * right section selected, e.g. when the app reopens on a title page.
 */
interface SectionState { section: string | null; setSection: (to: string | null) => void }

export const useSectionStore = create<SectionState>((set) => ({
  section: null,
  setSection: (section) => set({ section }),
}))

/** Declares the section of the page while it is shown (a route like '/manga'). */
export function useSection(to: string | null) {
  const setSection = useSectionStore((s) => s.setSection)
  useEffect(() => {
    setSection(to)
    return () => setSection(null)
  }, [to, setSection])
}
