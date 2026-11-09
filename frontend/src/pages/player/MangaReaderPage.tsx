import { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { spring } from '@/design/motion'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronLeft, ChevronRight, Maximize2, Minimize2, ZoomIn, ZoomOut, List as ListIcon,
} from 'lucide-react'
import Spinner from '@/components/ui/Spinner'
import Sheet from '@/components/ui/Sheet'
import SegmentedControl from '@/components/ui/SegmentedControl'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'
import { Group, ListRow } from '@/components/ui/GroupedList'
import { mediaService } from '@/services/mediaService'
import { api } from '@/services/api'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { getStreamToken, withStreamToken } from '@/services/streamToken'
import type { Chapter } from '@/types'
import { usePdfDocument } from '@/hooks/usePdfDocument'
import ReaderPage from '@/components/media/ReaderPage'
import { chapterVersions, versionName } from '@/components/media/chapterVersions'
import { loadImagePage, prefetchPages } from '@/services/readerCache'

type ReadMode = 'vertical' | 'page' | 'page-rtl'

/*
 * « Livre » page turn (page modes), transform / opacity only. Going forward, the page
 * being read turns away on its spine and uncovers the next one; going back, the
 * previous page turns back over it. The spine is on the left, on the right when the
 * manga is read right to left.
 */
interface Turn { dir: number; rtl: boolean }
const away = ({ rtl }: Turn) => (rtl ? 1 : -1) * 92
const PAGE_TURN: Variants = {
  enter: (t: Turn) => (t.dir > 0 ? { rotateY: 0, zIndex: 1 } : { rotateY: away(t), zIndex: 2 }),
  center: { rotateY: 0, zIndex: 1, opacity: 1 },
  // the page staying under the one turning back is kept until that one has landed
  exit: (t: Turn) => (t.dir > 0 ? { rotateY: away(t), zIndex: 2 } : { rotateY: 0, zIndex: 0, opacity: 0.999 }),
}
const PAGE_SHADE: Variants = {
  enter: (t: Turn) => ({ opacity: t.dir > 0 ? 0 : 0.45 }),
  center: { opacity: 0 },
  exit: (t: Turn) => ({ opacity: t.dir > 0 ? 0.45 : 0 }),
}

interface PageData {
  url:  string
  name: string
}

interface ChapterPagesResponse {
  success: boolean
  type:    'pdf' | 'images'
  pdfUrl?: string
  data:    PageData[]
}

/** Page width asked to the server: the screen's, in 160 px steps (shared cache) */
const PAGE_WIDTH = Math.min(1600, Math.max(480, Math.round(Math.min(window.innerWidth, 900) * Math.min(window.devicePixelRatio || 1, 3) / 160) * 160))

async function getChapterPages(chapterId: string): Promise<{ pages: PageData[]; pdfUrl: string | null }> {
  const { data } = await api.get<ChapterPagesResponse>(`/media/chapters/${chapterId}/pages`)
  const token    = await getStreamToken()

  if (data.type === 'pdf' && data.pdfUrl) {
    return { pages: [], pdfUrl: withStreamToken(data.pdfUrl, token) }
  }

  return {
    // Pages prepared by the server (light WebP at the screen's width)
    pages: data.data.map((p) => ({ ...p, url: withStreamToken(`${p.url}${p.url.includes('?') ? '&' : '?'}w=${PAGE_WIDTH}`, token) })),
    pdfUrl: null,
  }
}

export default function MangaReaderPage() {
  const { id }            = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate          = useNavigate()
  const chapterId         = searchParams.get('ch') || undefined
  const langParam         = searchParams.get('lang') || undefined

  // The reading mode chosen last is kept on this device (a manga read right to left stays so)
  const [mode,       setModeRaw]    = useState<ReadMode>(() => {
    try {
      const m = localStorage.getItem('nexus-reader-mode')
      return m === 'page' || m === 'page-rtl' ? m : 'vertical'
    } catch { return 'vertical' }
  })
  const setMode = (m: ReadMode) => {
    setModeRaw(m)
    try { localStorage.setItem('nexus-reader-mode', m) } catch { /* private mode */ }
  }
  const [zoom,       setZoom]       = useState(100)
  const [currentPage, setCurrentPage] = useState(0)
  const [fullscreen,  setFullscreen]  = useState(false)
  const [showUI,      setShowUI]      = useState(true)
  const uiTimer = useRef<NodeJS.Timeout | null>(null)
  const [showChapters, setShowChapters] = useState(false)
  const isDesktop   = useMediaQuery('(min-width: 1024px)')
  const lastPointer = useRef<string>('mouse')
  const swipeStart  = useRef<{ x: number; y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { data: media } = useQuery({
    queryKey: ['media', id],
    queryFn:  () => mediaService.getById(id!),
    enabled:  !!id,
  })

  const { data: chapterData, isLoading } = useQuery({
    queryKey: ['chapter-pages', chapterId],
    queryFn:  () => getChapterPages(chapterId!),
    enabled:  !!chapterId,
  })
  const pdfUrl = chapterData?.pdfUrl ?? null
  // PDF chapters: PDF.js renders the pages; placeholders keep page count / navigation identical
  const pdf = usePdfDocument(pdfUrl, chapterId)
  const pdfPlaceholders = Array.from({ length: pdf.numPages }, (_, i) => ({ url: '', name: `page-${i + 1}` }))
  const pages = pdfUrl ? pdfPlaceholders : (chapterData?.pages ?? [])

  const chapters: Chapter[] = media?.chapters || []
  const langs = chapterVersions(chapters)
  // The version of the chapter being read (« VF », « VF Noir et blanc »), so next / previous stay in it
  const activeLang = langParam ?? chapters.find((c) => c.id === chapterId)?.language ?? langs[0] ?? null
  const filteredChapters = activeLang
    ? chapters.filter((c) => c.language === activeLang)
    : chapters
  const currentChapterIndex = filteredChapters.findIndex((c) => c.id === chapterId)
  const prevChapter = filteredChapters[currentChapterIndex - 1]
  const nextChapter = filteredChapters[currentChapterIndex + 1]

  function changeLang(l: string) {
    const first = chapters.find((c) => c.language === l)
    if (first) setSearchParams({ ch: first.id, lang: l })
  }

  // Show/hide UI on mouse move
  function handleMouseMove() {
    if (lastPointer.current !== 'mouse') return
    setShowUI(true)
    if (uiTimer.current) clearTimeout(uiTimer.current)
    uiTimer.current = setTimeout(() => setShowUI(false), 3000)
  }

  // Keyboard navigation (page mode)
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (mode === 'vertical') return
      // Right to left (manga): ← is the next page, like turning a paper manga
      const rtl = mode === 'page-rtl'
      const next = e.key === 'ArrowDown' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
      const prev = e.key === 'ArrowUp' || e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')
      if (next) setCurrentPage((p) => Math.min(p + 1, pages.length - 1))
      if (prev) setCurrentPage((p) => Math.max(p - 1, 0))
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [mode, pages.length])

  // Save read progress
  useEffect(() => {
    if (!id || !chapterId || !pages.length) return
  }, [currentPage, id, chapterId, pages.length])

  // Touch: a tap toggles the reader UI
  function handleTap(e: React.MouseEvent) {
    if (lastPointer.current === 'mouse') return
    if ((e.target as HTMLElement).closest('button, a, input')) return
    if (uiTimer.current) clearTimeout(uiTimer.current)
    setShowUI((v) => !v)
  }

  // Page mode: swipe left/right to turn pages (direction follows reading mode)
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]
    swipeStart.current = { x: t.clientX, y: t.clientY }
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start || e.touches.length > 0) return
    const t  = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    const forward = mode === 'page-rtl' ? dx > 0 : dx < 0
    setCurrentPage((p) => forward ? Math.min(pages.length - 1, p + 1) : Math.max(0, p - 1))
  }

  function changeChapter(chap: Chapter) {
    setShowChapters(false)
    const params: Record<string, string> = { ch: chap.id }
    if (activeLang) params.lang = activeLang
    setSearchParams(params)
    setCurrentPage(0)
    containerRef.current?.scrollTo(0, 0)
  }

  const pageImg = pages[currentPage]
  // Direction of the last page turn (book effect): forward or back
  const lastPage = useRef(currentPage)
  const turnDir = useRef(1)
  // Proportions of the pages already shown (the spine is the real edge of the drawn page)
  const [ratios, setRatios] = useState<Record<string, number>>({})
  const spine = (n: number) => {
    const ratio = ratios[`${chapterId}-${n}`] ?? (pdfUrl ? pdf.ratio(n) : undefined) ?? 0.68
    // the page is drawn centred, as wide as the zoom allows and at most as tall as the screen
    const half = `min(${(isDesktop ? zoom : 100) / 2}%, ${ratio * 50}dvh)`
    return mode === 'page-rtl' ? `calc(50% + ${half}) 50%` : `calc(50% - ${half}) 50%`
  }
  if (currentPage !== lastPage.current) {
    turnDir.current = currentPage > lastPage.current ? 1 : -1
    lastPage.current = currentPage
  }

  /** Page image: device cache first; PDF pages drawn by PDF.js, image pages downloaded once */
  const loadPage = (n: number, url: string) => () =>
    pdfUrl ? pdf.render(n) : loadImagePage(chapterId ?? '', n, url).then((b) => {
      // Like manga sites: the next pages are already coming while this one is read
      void prefetchPages(chapterId ?? '', pages.slice(n, n + 4).map((p, i) => ({ n: n + 1 + i, url: p.url })))
      return URL.createObjectURL(b)
    })

  const barBtn = 'w-9 h-9 grid place-items-center rounded-full text-white/85 hover:text-white hover:bg-white/10 active:bg-white/20'
  const chapterLabel = (c: Chapter) => c.title || `Chapitre ${c.chapterNumber}`
  const current = filteredChapters[currentChapterIndex]
  const pill = 'px-3.5 min-h-[32px] rounded-full text-[13px] font-medium'

  const chapterList = (
    <>
      {(
        <Group header="Mode de lecture" className="mb-6">
          {([['vertical', 'Défilement vertical'], ['page', 'Page par page'], ['page-rtl', 'Page par page, de droite à gauche']] as const).map(([m, label]) => (
            <ListRow key={m} title={label} onClick={() => setMode(m)} accessory={mode === m ? <span className="text-accent font-semibold" aria-label="Sélectionné">✓</span> : undefined} />
          ))}
        </Group>
      )}
      {langs.length > 1 && (
        <SegmentedControl full label="Version" value={activeLang} onChange={changeLang}
          options={langs.map((l) => ({ value: l, label: versionName(l, langs) }))} className="mb-4" />
      )}
      <Group>
        {filteredChapters.map((chap) => (
          <ListRow
            key={chap.id}
            onClick={() => { changeChapter(chap); setShowChapters(false) }}
            selected={chap.id === chapterId}
            title={chapterLabel(chap)}
            detail={chap.id === chapterId ? 'En cours' : chap.pageCount ? `${chap.pageCount} p.` : undefined}
          />
        ))}
      </Group>
    </>
  )

  return (
    <div
      ref={containerRef}
      className={`${fullscreen ? 'fixed inset-0 z-50 overflow-y-auto' : 'min-h-[100dvh]'} flex flex-col select-none bg-black`}
      onMouseMove={handleMouseMove}
      onPointerDown={(e) => { lastPointer.current = e.pointerType }}
      onClick={handleTap}
    >
      {/* Top bar: appears on move / tap, fades while reading */}
      <div
        // Apple Books: the reading chrome floats in clear glass and fades away while reading
        className="fixed z-30 left-2.5 right-2.5 flex items-center gap-2 px-2 min-h-[48px] rounded-[26px] glass-media transition-[opacity,transform] duration-300"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)', opacity: showUI ? 1 : 0, transform: showUI ? 'none' : 'translateY(-6px)', pointerEvents: showUI ? 'auto' : 'none' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="flex items-center min-h-[44px] pr-2 text-[17px] md:text-body text-white/90 hover:text-white min-w-0" onClick={() => navigate(`/media/${id}`)} aria-label="Retour">
          <ChevronLeft size={24} strokeWidth={2} className="flex-shrink-0" aria-hidden="true" />
          <span className="truncate max-w-[30vw] md:max-w-[240px]">{media?.title ?? 'Retour'}</span>
        </button>
        <span className="flex-1 min-w-0 text-center text-subhead text-white/70 truncate max-md:text-right max-md:pr-1">{current ? chapterLabel(current) : ''}</span>
        <div className="flex items-center gap-1 flex-shrink-0 [&_[role=radiogroup]]:bg-white/10 [--seg-on:rgba(255,255,255,.28)] [&_[role=radio]]:text-white">
          {isDesktop && (
            <SegmentedControl
              label="Mode de lecture"
              value={mode}
              onChange={(m) => setMode(m as ReadMode)}
              options={[
                { value: 'vertical', label: 'Défilement', title: 'Défilement vertical' },
                { value: 'page', label: 'Page', title: 'Page par page' },
                { value: 'page-rtl', label: '← Manga', title: 'Page par page, de droite à gauche' },
              ]}
              className="max-sm:[&_[role=radio]]:px-2"
            />
          )}
          {isDesktop && (
            <>
              <button type="button" className={barBtn} onClick={() => setZoom((z) => Math.max(50, z - 10))} aria-label="Zoom arrière"><ZoomOut size={16} strokeWidth={1.5} /></button>
              <button type="button" className="text-caption text-white/70 tabular w-12 whitespace-nowrap text-center hover:text-white" onClick={() => setZoom(100)} title="Taille réelle">{zoom} %</button>
              <button type="button" className={barBtn} onClick={() => setZoom((z) => Math.min(200, z + 10))} aria-label="Zoom avant"><ZoomIn size={16} strokeWidth={1.5} /></button>
            </>
          )}
          {!isDesktop && (
            <button type="button" className={barBtn} onClick={() => setShowChapters(true)} aria-label="Options de lecture et chapitres"><ListIcon size={18} strokeWidth={1.5} /></button>
          )}
          <button type="button" className={barBtn} onClick={() => setFullscreen((f) => !f)} aria-label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}>
            {fullscreen ? <Minimize2 size={16} strokeWidth={1.5} /> : <Maximize2 size={16} strokeWidth={1.5} />}
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading || (pdfUrl && !pdf.error && pdf.numPages === 0) ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 min-h-[100dvh] text-white/80" role="status">
          <Spinner size={32} color="rgba(255,255,255,.85)" />
          {pdfUrl && <span className="text-[13px]">Ouverture du chapitre…</span>}
        </div>
      ) : pdfUrl && pdf.error ? (
        <div className="flex-1 grid place-items-center min-h-[100dvh] text-white [--label:#f5f5f7] [--label-2:#98989d] [--label-3:#636366]">
          <EmptyState tone="error" title="Ce PDF ne peut pas être affiché" message={`${pdf.error}. Tu peux le télécharger pour le lire ailleurs.`}
            action={<a className="inline-flex items-center px-4 min-h-[32px] rounded-full bg-white text-black text-[13px] font-medium" href={pdfUrl} target="_blank" rel="noopener noreferrer">Ouvrir le PDF</a>} />
        </div>
      ) : pages.length === 0 ? (
        <div className="flex-1 grid place-items-center min-h-[100dvh] text-white [--label:#f5f5f7] [--label-2:#98989d] [--label-3:#636366]">
          <EmptyState title="Ce chapitre est vide" message="Aucune page n’a été trouvée. Lance une analyse depuis la page du manga." action={<Button onClick={() => navigate(`/media/${id}`)}>Retour à la fiche</Button>} />
        </div>
      ) : mode === 'vertical' ? (
        <div className="flex flex-col items-center pt-14 pb-8 gap-0.5" style={{ minHeight: '100dvh' }}>
          {pages.map((page, i) => (
            <ReaderPage
              key={`${chapterId}-${i}`}
              n={i + 1}
              load={loadPage(i + 1, page.url)}
              ratio={pdfUrl ? pdf.ratio(i + 1) : undefined}
              revoke={!pdfUrl}
              eager={i < 2}
              className="block"
              style={{ width: isDesktop ? `${zoom}%` : '100%', maxWidth: '900px' }}
            />
          ))}
          <div className="flex flex-wrap justify-center gap-3 mt-10 px-4" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} onClick={(e) => e.stopPropagation()}>
            {prevChapter && <button type="button" className={`${pill} bg-white/15 text-white hover:bg-white/25`} onClick={() => changeChapter(prevChapter)}>Chapitre précédent</button>}
            {nextChapter && <button type="button" className={`${pill} bg-white text-black`} onClick={() => changeChapter(nextChapter)}>Chapitre suivant</button>}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center relative" style={{ minHeight: '100dvh', touchAction: 'pan-y pinch-zoom' }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {/* Book effect: the page turns on its spine (left, or right when read right to left) */}
          <div className="absolute inset-0" style={{ perspective: 2000 }}>
            <AnimatePresence key={chapterId} initial={false} custom={{ dir: turnDir.current, rtl: mode === 'page-rtl' }}>
              {pageImg && (
                <motion.div
                  key={currentPage}
                  custom={{ dir: turnDir.current, rtl: mode === 'page-rtl' }}
                  variants={PAGE_TURN}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={spring.sheet}
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ transformOrigin: spine(currentPage + 1), backfaceVisibility: 'hidden', willChange: 'transform' }}
                  onLoadCapture={(e) => {
                    const img = e.target as HTMLImageElement
                    const k = `${chapterId}-${currentPage + 1}`
                    if (img.naturalWidth && img.naturalHeight) setRatios((r) => (r[k] ? r : { ...r, [k]: img.naturalWidth / img.naturalHeight }))
                  }}
                >
                  <ReaderPage
                    n={currentPage + 1}
                    load={loadPage(currentPage + 1, pageImg.url)}
                    ratio={pdfUrl ? pdf.ratio(currentPage + 1) : undefined}
                    revoke={!pdfUrl}
                    eager
                    className="object-contain"
                    style={{ maxHeight: '100dvh', maxWidth: '100%', width: isDesktop ? `${zoom}%` : '100%' }}
                  />
                  {/* The page darkens as it turns away from the light */}
                  <motion.div variants={PAGE_SHADE} custom={{ dir: turnDir.current, rtl: mode === 'page-rtl' }} transition={spring.sheet}
                    className="absolute inset-0 pointer-events-none bg-black" aria-hidden="true" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {isDesktop && (() => {
            // Right to left (manga): the next page is on the left
            const rtl = mode === 'page-rtl'
            const prev = () => setCurrentPage((p) => Math.max(0, p - 1))
            const next = () => setCurrentPage((p) => Math.min(pages.length - 1, p + 1))
            const side = (which: 'left' | 'right') => {
              const isNext = (which === 'left') === rtl
              return (
                <button type="button" className={`absolute z-10 ${which === 'left' ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2 w-10 h-10 grid place-items-center rounded-full glass-media disabled:opacity-0 transition-opacity`} style={{ opacity: showUI ? 1 : 0 }}
                  onClick={(e) => { e.stopPropagation(); if (isNext) next(); else prev() }}
                  disabled={isNext ? currentPage >= pages.length - 1 : currentPage === 0}
                  aria-label={isNext ? 'Page suivante' : 'Page précédente'}>
                  {which === 'left' ? <ChevronLeft size={20} strokeWidth={1.75} /> : <ChevronRight size={20} strokeWidth={1.75} />}
                </button>
              )
            }
            return <>{side('left')}{side('right')}</>
          })()}
        </div>
      )}

      {/* Bottom bar (page modes): position, page count, chapters */}
      {mode !== 'vertical' && pages.length > 0 && (
        <div
          className="fixed z-30 left-2.5 right-2.5 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[min(640px,calc(100%-32px))] rounded-[26px] glass-media px-4 pt-2.5 pb-3 transition-[opacity,transform] duration-300"
          style={{ bottom: 'max(10px, env(safe-area-inset-bottom))', opacity: showUI ? 1 : 0, transform: showUI ? 'none' : 'translateY(6px)', pointerEvents: showUI ? 'auto' : 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="range"
            min={1}
            max={pages.length}
            value={currentPage + 1}
            onChange={(e) => setCurrentPage(Number(e.target.value) - 1)}
            className="w-full mb-2"
            style={{ accentColor: 'white', direction: mode === 'page-rtl' ? 'rtl' : 'ltr' }}
            aria-label="Page"
            aria-valuetext={`Page ${currentPage + 1} sur ${pages.length}`}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1">{prevChapter && <button type="button" className={`${pill} bg-white/15 hover:bg-white/25`} onClick={() => changeChapter(prevChapter)}>Précédent</button>}</div>
            <span className="text-caption text-white/70 tabular">Page {currentPage + 1} sur {pages.length}</span>
            <div className="flex-1 flex justify-end">{nextChapter && <button type="button" className={`${pill} bg-white text-black`} onClick={() => changeChapter(nextChapter)}>Suivant</button>}</div>
          </div>
        </div>
      )}

      {/* Chapters: side panel on desktop (with the bars), bottom sheet on phones */}
      {isDesktop && filteredChapters.length > 0 && (
        <aside
          aria-label="Chapitres"
          className="fixed right-2.5 bottom-2.5 w-60 z-20 overflow-y-auto rounded-[26px] glass-media transition-transform duration-slow ease-sheet"
          style={{ top: 66, transform: showUI ? 'none' : 'translateX(calc(100% + 16px))' }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-4 pt-4 pb-2 text-caption font-semibold text-white/60">Chapitres · {filteredChapters.length}</p>
          {langs.length > 1 && (
            <div className="flex gap-1 px-3 pb-2">
              {langs.map((l) => (
                <button key={l} type="button" onClick={() => changeLang(l)} aria-pressed={activeLang === l}
                  className={`px-2 min-h-[24px] rounded-[6px] text-caption font-medium ${activeLang === l ? 'bg-white/25 text-white' : 'text-white/60 hover:bg-white/10'}`}>{versionName(l, langs)}</button>
              ))}
            </div>
          )}
          <ul className="pb-4 px-2">
            {filteredChapters.map((chap) => (
              <li key={chap.id}>
                <button type="button" onClick={() => changeChapter(chap)} aria-current={chap.id === chapterId ? 'true' : undefined}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 h-8 rounded-[6px] text-body text-left ${chap.id === chapterId ? 'bg-accent text-white' : 'text-white/80 hover:bg-white/10'}`}>
                  <span className="truncate">{chapterLabel(chap)}</span>
                  {chap.pageCount ? <span className="text-caption opacity-60 tabular">{chap.pageCount} p.</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
      {!isDesktop && (
        <Sheet open={showChapters} onClose={() => setShowChapters(false)} title="Lecture">
          {chapterList}
        </Sheet>
      )}
    </div>
  )
}
