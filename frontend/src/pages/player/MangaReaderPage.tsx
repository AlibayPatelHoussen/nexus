import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, ChevronLeft, ChevronRight,
  Maximize2, Minimize2, BookOpen, AlignJustify,
  ZoomIn, ZoomOut, RotateCcw,
} from 'lucide-react'
import { mediaService } from '@/services/mediaService'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
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
  const token    = useAuthStore.getState().accessToken ?? ''

  if (data.type === 'pdf' && data.pdfUrl) {
    return { pages: [], pdfUrl: `${data.pdfUrl}&token=${encodeURIComponent(token)}` }
  }

  return {
    pages: data.data.map((p) => ({ ...p, url: `${p.url}&token=${encodeURIComponent(token)}` })),
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

  function changeChapter(chap: Chapter) {
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
      className={`${fullscreen ? 'fixed inset-0 z-50' : 'min-h-screen'} flex flex-col select-none`}
      style={{ background: '#0a0a0a' }}
      onMouseMove={handleMouseMove}
    >
      {/* Top UI */}
      <div
        className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 transition-all duration-300"
        style={{
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.85), transparent)',
          opacity:    showUI ? 1 : 0,
          pointerEvents: showUI ? 'auto' : 'none',
        }}
      >
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-1.5 text-[13px] text-white/70 hover:text-white"
            onClick={() => navigate(`/manga`)}>
            <ArrowLeft size={16} strokeWidth={2} /> Retour
          </button>
          {media && (
            <span className="text-white/50 text-[13px] font-mono">
              {media.title}
              {chapterId && filteredChapters[currentChapterIndex] && ` · Ch.${filteredChapters[currentChapterIndex].chapterNumber}`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.1)' }}>
            {(['vertical', 'page', 'page-rtl'] as ReadMode[]).map((m) => (
              <button
                key={m}
                className="px-2 py-1 rounded text-[11px] font-medium transition-all"
                style={{
                  background: mode === m ? 'rgba(255,255,255,0.2)' : 'transparent',
                  color:      mode === m ? 'white'                   : 'rgba(255,255,255,0.5)',
                }}
                onClick={() => setMode(m)}
              >
                {m === 'vertical' ? <AlignJustify size={13} strokeWidth={2} />
                  : m === 'page' ? <BookOpen size={13} strokeWidth={2} />
                  : <span className="text-[10px]">RTL</span>
                }
              </button>
            ))}
          </div>

          {/* Zoom */}
          <button className="w-7 h-7 rounded flex items-center justify-center text-white/60 hover:text-white"
            style={{ background: 'rgba(255,255,255,0.08)' }}
            onClick={() => setZoom((z) => Math.max(50, z - 10))}>
            <ZoomOut size={14} strokeWidth={2} />
          </button>
          <span className="text-[11px] font-mono text-white/60 w-8 text-center">{zoom}%</span>
          <button className="w-7 h-7 rounded flex items-center justify-center text-white/60 hover:text-white"
            style={{ background: 'rgba(255,255,255,0.08)' }}
            onClick={() => setZoom((z) => Math.min(200, z + 10))}>
            <ZoomIn size={14} strokeWidth={2} />
          </button>
          <button className="w-7 h-7 rounded flex items-center justify-center text-white/60 hover:text-white"
            style={{ background: 'rgba(255,255,255,0.08)' }}
            onClick={() => setZoom(100)}>
            <RotateCcw size={12} strokeWidth={2} />
          </button>

          {/* Fullscreen */}
          <button className="w-7 h-7 rounded flex items-center justify-center text-white/60 hover:text-white"
            style={{ background: 'rgba(255,255,255,0.08)' }}
            onClick={() => setFullscreen((f) => !f)}>
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
        <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ minHeight: '100vh' }}>
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
          style={{ minHeight: '100vh' }}
          title="Manga PDF"
        />

      ) : mode === 'vertical' ? (

        /* ── VERTICAL SCROLL ── */
        <div
          className="flex flex-col items-center py-14 gap-0.5"
          style={{ minHeight: '100vh' }}
        >
          {pages.map((page, i) => (
            <img
              key={i}
              src={page.url}
              alt={`Page ${i + 1}`}
              className="block"
              style={{ width: `${zoom}%`, maxWidth: '900px' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ))}

          {/* Chapter nav */}
          <div className="flex gap-3 mt-8 mb-4">
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
        <div className="flex-1 flex items-center justify-center relative" style={{ minHeight: '100vh' }}>
          {pageImg && (
            <img
              src={pageImg.url}
              alt={`Page ${currentPage + 1}`}
              className="object-contain"
              style={{
                maxHeight: '95vh',
                maxWidth:  '100%',
                width:     `${zoom}%`,
                transform: mode === 'page-rtl' ? 'scaleX(-1)' : 'none',
              }}
            />
          )}

          {/* Page nav left */}
          <button
            className="absolute left-2 top-1/2 -translate-y-1/2 w-12 h-20 flex items-center justify-center rounded-lg transition-opacity"
            style={{ background: 'rgba(255,255,255,0.05)', opacity: currentPage > 0 ? 1 : 0.2 }}
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft size={22} strokeWidth={2} color="white" />
          </button>

          {/* Page nav right */}
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 w-12 h-20 flex items-center justify-center rounded-lg transition-opacity"
            style={{ background: 'rgba(255,255,255,0.05)', opacity: currentPage < pages.length - 1 ? 1 : 0.2 }}
            onClick={() => setCurrentPage((p) => Math.min(pages.length - 1, p + 1))}
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
            padding:       '24px 16px 12px',
          }}
        >
          {/* Progress bar */}
          <div
            className="w-full h-1 rounded-full mb-3 cursor-pointer"
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

          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {prevChapter && (
                <button className="btn-ghost text-[12px]" onClick={() => changeChapter(prevChapter)}>
                  ← Ch.{prevChapter.chapterNumber}
                </button>
              )}
            </div>
            <span className="text-[12px] font-mono" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {currentPage + 1} / {pages.length}
            </span>
            <div className="flex gap-2">
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
      {filteredChapters.length > 0 && (
        <div
          className="fixed right-0 top-0 bottom-0 w-56 border-l overflow-y-auto transition-all duration-300 z-20"
          style={{
            background:    'rgba(0,0,0,0.85)',
            borderColor:   'rgba(255,255,255,0.05)',
            transform:     showUI ? 'translateX(0)' : 'translateX(100%)',
            backdropFilter:'blur(12px)',
          }}
        >
          <div className="p-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: 'rgba(255,255,255,0.4)' }}>
              Chapitres ({filteredChapters.length})
            </p>
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
                className="text-left px-3 py-2 text-[12.5px] transition-colors"
                style={{
                  background: chap.id === chapterId ? 'rgba(79,142,247,0.15)' : 'transparent',
                  color:      chap.id === chapterId ? 'var(--blue)'            : 'rgba(255,255,255,0.6)',
                }}
                onMouseEnter={(e) => { if (chap.id !== chapterId) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                onMouseLeave={(e) => { if (chap.id !== chapterId) e.currentTarget.style.background = 'transparent' }}
                onClick={() => changeChapter(chap)}
              >
                Ch.{chap.chapterNumber} {chap.title && `— ${chap.title}`}
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
