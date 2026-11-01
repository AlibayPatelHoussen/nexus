import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, ChevronLeft, ChevronRight,
  Maximize2, Minimize2, BookOpen, AlignJustify,
  ZoomIn, ZoomOut, RotateCcw, List as ListIcon, X,
} from 'lucide-react'
import { mediaService } from '@/services/mediaService'
import { api } from '@/services/api'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { getStreamToken, withStreamToken } from '@/services/streamToken'
import type { Chapter } from '@/types'

type ReadMode = 'vertical' | 'page' | 'page-rtl'

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

async function getChapterPages(chapterId: string): Promise<{ pages: PageData[]; pdfUrl: string | null }> {
  const { data } = await api.get<ChapterPagesResponse>(`/media/chapters/${chapterId}/pages`)
  const token    = await getStreamToken()

  if (data.type === 'pdf' && data.pdfUrl) {
    return { pages: [], pdfUrl: withStreamToken(data.pdfUrl, token) }
  }

  return {
    pages: data.data.map((p) => ({ ...p, url: withStreamToken(p.url, token) })),
    pdfUrl: null,
  }
}

export default function MangaReaderPage() {
  const { id }            = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate          = useNavigate()
  const chapterId         = searchParams.get('ch') || undefined
  const langParam         = searchParams.get('lang') || undefined

  const [mode,       setMode]       = useState<ReadMode>('vertical')
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
  const pages  = chapterData?.pages  ?? []
  const pdfUrl = chapterData?.pdfUrl ?? null

  const chapters: Chapter[] = media?.chapters || []
  const langs = [...new Set(chapters.map((c) => c.language).filter(Boolean))] as string[]
  const activeLang = langParam ?? langs[0] ?? null
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
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown')  setCurrentPage((p) => Math.min(p + 1, pages.length - 1))
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')    setCurrentPage((p) => Math.max(p - 1, 0))
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

  return (
    <div
      ref={containerRef}
      className={`${fullscreen ? 'fixed inset-0 z-50 overflow-y-auto' : 'min-h-[100dvh]'} flex flex-col select-none`}
      style={{ background: '#0a0a0a' }}
      onMouseMove={handleMouseMove}
      onPointerDown={(e) => { lastPointer.current = e.pointerType }}
      onClick={handleTap}
    >
      {/* Top UI */}
      <div
        className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between gap-2 px-3 sm:px-4 py-3 transition-all duration-300"
        style={{
          paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.85), transparent)',
          opacity:    showUI ? 1 : 0,
          pointerEvents: showUI ? 'auto' : 'none',
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button className="flex items-center gap-1.5 text-[13px] text-white/70 hover:text-white flex-shrink-0 p-1 -m-1"
            onClick={() => navigate(`/manga`)} aria-label="Retour">
            <ArrowLeft size={16} strokeWidth={2} /> <span className="hidden sm:inline">Retour</span>
          </button>
          {media && (
            <span className="text-white/50 text-[12px] sm:text-[13px] font-mono truncate min-w-0">
              {media.title}
              {chapterId && filteredChapters[currentChapterIndex] && ` · Ch.${filteredChapters[currentChapterIndex].chapterNumber}`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {/* Mode toggle */}
          <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.1)' }}>
            {(['vertical', 'page', 'page-rtl'] as ReadMode[]).map((m) => (
              <button
                key={m}
                className="px-2 py-1.5 sm:py-1 rounded text-[11px] font-medium transition-all"
                style={{
                  background: mode === m ? 'rgba(255,255,255,0.2)' : 'transparent',
                  color:      mode === m ? 'white'                   : 'rgba(255,255,255,0.5)',
                }}
                onClick={() => setMode(m)}
                aria-label={m === 'vertical' ? 'Défilement vertical' : m === 'page' ? 'Page par page' : 'Page par page (droite à gauche)'}
              >
                {m === 'vertical' ? <AlignJustify size={13} strokeWidth={2} />
                  : m === 'page' ? <BookOpen size={13} strokeWidth={2} />
                  : <span className="text-[10px]">RTL</span>
                }
              </button>
            ))}
          </div>

          {/* Zoom (phones use pinch-zoom) */}
          <button className="hidden md:flex w-7 h-7 rounded items-center justify-center text-white/60 hover:text-white"
            style={{ background: 'rgba(255,255,255,0.08)' }}
            onClick={() => setZoom((z) => Math.max(50, z - 10))}>
            <ZoomOut size={14} strokeWidth={2} />
          </button>
          <span className="hidden md:inline text-[11px] font-mono text-white/60 w-8 text-center">{zoom}%</span>
          <button className="hidden md:flex w-7 h-7 rounded items-center justify-center text-white/60 hover:text-white"
            style={{ background: 'rgba(255,255,255,0.08)' }}
            onClick={() => setZoom((z) => Math.min(200, z + 10))}>
            <ZoomIn size={14} strokeWidth={2} />
          </button>
          <button className="hidden md:flex w-7 h-7 rounded items-center justify-center text-white/60 hover:text-white"
            style={{ background: 'rgba(255,255,255,0.08)' }}
            onClick={() => setZoom(100)}>
            <RotateCcw size={12} strokeWidth={2} />
          </button>

          {/* Chapter list (drawer below lg) */}
          {filteredChapters.length > 0 && (
            <button className="lg:hidden w-8 h-8 rounded flex items-center justify-center text-white/70 hover:text-white"
              style={{ background: 'rgba(255,255,255,0.08)' }}
              onClick={() => setShowChapters((v) => !v)}
              aria-label="Liste des chapitres" aria-expanded={showChapters}>
              <ListIcon size={15} strokeWidth={2} />
            </button>
          )}

          {/* Fullscreen */}
          <button className="w-8 h-8 sm:w-7 sm:h-7 rounded flex items-center justify-center text-white/60 hover:text-white"
            style={{ background: 'rgba(255,255,255,0.08)' }}
            onClick={() => setFullscreen((f) => !f)}
            aria-label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}>
            {fullscreen ? <Minimize2 size={13} strokeWidth={2} /> : <Maximize2 size={13} strokeWidth={2} />}
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 rounded-full animate-spin"
            style={{ borderColor: 'rgba(255,255,255,0.2)', borderTopColor: 'white' }} />
        </div>
      ) : !pdfUrl && pages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ minHeight: '100dvh' }}>
          <p className="text-[14px] font-semibold" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Aucun contenu trouvé
          </p>
          <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Lancez un scan depuis la page du manga
          </p>
          <button
            className="btn-ghost text-[12px] mt-2"
            onClick={() => navigate(`/media/${id}`)}
          >
            ← Retour
          </button>
        </div>
      ) : pdfUrl ? (

        /* ── PDF MODE ── */
        <iframe
          src={pdfUrl}
          className="flex-1 w-full border-0"
          style={{ minHeight: '100dvh' }}
          title="Manga PDF"
        />

      ) : mode === 'vertical' ? (

        /* ── VERTICAL SCROLL ── */
        <div
          className="flex flex-col items-center py-14 gap-0.5"
          style={{ minHeight: '100dvh' }}
        >
          {pages.map((page, i) => (
            <img
              key={i}
              src={page.url}
              alt={`Page ${i + 1}`}
              className="block"
              style={{ width: isDesktop ? `${zoom}%` : '100%', maxWidth: '900px' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ))}

          {/* Chapter nav */}
          <div className="flex flex-wrap justify-center gap-3 mt-8 mb-4 px-4" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {prevChapter && (
              <button className="btn-ghost text-[13px]" onClick={() => changeChapter(prevChapter)}>
                ← Ch.{prevChapter.chapterNumber}
              </button>
            )}
            {nextChapter && (
              <button className="btn-primary text-[13px]" onClick={() => changeChapter(nextChapter)}>
                Ch.{nextChapter.chapterNumber} →
              </button>
            )}
          </div>
        </div>

      ) : (

        /* ── PAGE MODE ── */
        <div
          className="flex-1 flex items-center justify-center relative"
          style={{ minHeight: '100dvh', touchAction: 'pan-y pinch-zoom' }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {pageImg && (
            <img
              src={pageImg.url}
              alt={`Page ${currentPage + 1}`}
              className="object-contain"
              style={{
                maxHeight: '95dvh',
                maxWidth:  '100%',
                width:     isDesktop ? `${zoom}%` : '100%',
                transform: mode === 'page-rtl' ? 'scaleX(-1)' : 'none',
              }}
            />
          )}

          {/* Page nav left */}
          <button
            className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 w-12 h-20 items-center justify-center rounded-lg transition-opacity"
            style={{ background: 'rgba(255,255,255,0.05)', opacity: currentPage > 0 ? 1 : 0.2 }}
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
            aria-label="Page précédente"
          >
            <ChevronLeft size={22} strokeWidth={2} color="white" />
          </button>

          {/* Page nav right */}
          <button
            className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 w-12 h-20 items-center justify-center rounded-lg transition-opacity"
            style={{ background: 'rgba(255,255,255,0.05)', opacity: currentPage < pages.length - 1 ? 1 : 0.2 }}
            onClick={() => setCurrentPage((p) => Math.min(pages.length - 1, p + 1))}
            aria-label="Page suivante"
          >
            <ChevronRight size={22} strokeWidth={2} color="white" />
          </button>
        </div>
      )}

      {/* Bottom bar — page mode */}
      {mode !== 'vertical' && (
        <div
          className="fixed bottom-0 left-0 right-0 z-30 transition-all duration-300"
          style={{
            background:    'linear-gradient(to top, rgba(0,0,0,0.9), transparent)',
            opacity:       showUI ? 1 : 0,
            pointerEvents: showUI ? 'auto' : 'none',
            padding:       '24px 16px max(12px, env(safe-area-inset-bottom))',
          }}
        >
          {/* Progress bar */}
          <div
            className="w-full h-1.5 sm:h-1 rounded-full mb-3 cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.15)' }}
            onClick={(e) => {
              const rect  = e.currentTarget.getBoundingClientRect()
              const ratio = (e.clientX - rect.left) / rect.width
              setCurrentPage(Math.floor(ratio * pages.length))
            }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width:      `${((currentPage + 1) / pages.length) * 100}%`,
                background: 'var(--blue)',
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-2 flex-1">
              {prevChapter && (
                <button className="btn-ghost text-[12px]" onClick={() => changeChapter(prevChapter)}>
                  ← Ch.{prevChapter.chapterNumber}
                </button>
              )}
            </div>
            <span className="text-[12px] font-mono" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {currentPage + 1} / {pages.length}
            </span>
            <div className="flex gap-2 flex-1 justify-end">
              {nextChapter && (
                <button className="btn-primary text-[12px]" onClick={() => changeChapter(nextChapter)}>
                  Ch.{nextChapter.chapterNumber} →
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Chapter selector sidebar */}
      {/* Mobile backdrop for the chapter drawer */}
      {!isDesktop && showChapters && (
        <div className="fixed inset-0 z-[35] bg-black/50" onClick={() => setShowChapters(false)} aria-hidden="true" />
      )}

      {filteredChapters.length > 0 && (
        <div
          className={`fixed right-0 top-0 bottom-0 border-l overflow-y-auto transition-all duration-300 ${
            isDesktop ? 'w-56 z-20' : 'w-[80vw] max-w-[300px] z-40'}`}
          style={{
            background:    isDesktop ? 'rgba(0,0,0,0.85)' : 'rgba(10,10,10,0.97)',
            borderColor:   'rgba(255,255,255,0.05)',
            transform:     (isDesktop ? showUI : showChapters) ? 'translateX(0)' : 'translateX(100%)',
            backdropFilter:'blur(12px)',
            paddingTop:    isDesktop ? undefined : 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: 'rgba(255,255,255,0.4)' }}>
              Chapitres ({filteredChapters.length})
            </p>
            {!isDesktop && (
              <button className="p-1.5 -m-1.5 text-white/60" onClick={() => setShowChapters(false)} aria-label="Fermer">
                <X size={16} strokeWidth={2} />
              </button>
            )}
          </div>

          {/* Language tabs */}
          {langs.length >= 1 && (
            <div className="flex gap-1 px-3 py-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              {langs.map((l) => (
                <button
                  key={l}
                  className="px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-all"
                  style={{
                    background: activeLang === l ? 'rgba(79,142,247,0.3)' : 'rgba(255,255,255,0.08)',
                    color:      activeLang === l ? 'var(--blue)'           : 'rgba(255,255,255,0.5)',
                  }}
                  onClick={() => changeLang(l)}
                >
                  {l}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col py-1">
            {filteredChapters.map((chap) => (
              <button
                key={chap.id}
                className="text-left px-3 py-3 lg:py-2 text-[13px] lg:text-[12.5px] transition-colors"
                style={{
                  background: chap.id === chapterId ? 'rgba(79,142,247,0.15)' : 'transparent',
                  color:      chap.id === chapterId ? 'var(--blue)'            : 'rgba(255,255,255,0.6)',
                }}
                onMouseEnter={(e) => { if (chap.id !== chapterId) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                onMouseLeave={(e) => { if (chap.id !== chapterId) e.currentTarget.style.background = 'transparent' }}
                onClick={() => changeChapter(chap)}
              >
                Chapitre {chap.chapterNumber}
                {chap.pageCount && (
                  <span className="ml-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {chap.pageCount}p
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
