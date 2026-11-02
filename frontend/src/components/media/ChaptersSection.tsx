import { useMemo, useState } from 'react'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, BookOpen, ChevronRight, FileText, Package, RefreshCw } from 'lucide-react'
import type { Chapter } from '@/types'

interface Props {
  chapters:  Chapter[]
  onRead:    (chapterId: string) => void
  onScan:    () => void
  scanning:  boolean
}

const formatNumber = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''))

function kindOf(path: string): 'pdf' | 'archive' | 'images' {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'cbz' || ext === 'zip') return 'archive'
  return 'images'
}

/** Chapter list of a manga: sorted by number, click to read; clear empty state. */
export default function ChaptersSection({ chapters, onRead, onScan, scanning }: Props) {
  const [desc, setDesc] = useState(false)
  const sorted = useMemo(
    () => [...chapters].sort((a, b) => (desc ? -1 : 1) * (a.chapterNumber - b.chapterNumber || a.folderPath.localeCompare(b.folderPath, undefined, { numeric: true }))),
    [chapters, desc],
  )

  if (chapters.length === 0) {
    return (
      <section className="card p-5 sm:p-6 mb-5 flex flex-col items-center text-center gap-2 animate-fade-up">
        <BookOpen size={32} strokeWidth={1.5} style={{ color: 'var(--text3)' }} />
        <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Aucun chapitre trouvé</p>
        <p className="text-[12px] max-w-sm" style={{ color: 'var(--text3)' }}>
          Range les chapitres dans le dossier du manga : un dossier d'images par chapitre, ou des fichiers
          <span className="font-mono"> .pdf</span> / <span className="font-mono">.cbz</span>, puis relance un scan.
        </p>
        <button className="btn-primary text-[12.5px] mt-2" onClick={onScan} disabled={scanning}>
          <RefreshCw size={13} strokeWidth={2} className={scanning ? 'animate-spin' : ''} /> Scanner les chapitres
        </button>
      </section>
    )
  }

  return (
    <section className="card overflow-hidden mb-5 animate-fade-up" style={{ animationDelay: '60ms' }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 pt-4 sm:pt-5 pb-3">
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>
          Chapitres <span style={{ color: 'var(--text3)' }}>({chapters.length})</span>
        </h2>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost text-[12px] px-3"
            onClick={() => setDesc((d) => !d)}
            aria-label={desc ? 'Trier du premier au dernier' : 'Trier du dernier au premier'}
            title={desc ? 'Du dernier au premier' : 'Du premier au dernier'}
          >
            {desc ? <ArrowDownWideNarrow size={13} /> : <ArrowUpNarrowWide size={13} />}
            <span className="hidden sm:inline">{desc ? 'Plus récents' : 'Dans l\'ordre'}</span>
          </button>
          <button className="btn-primary text-[12px]" onClick={() => onRead(sorted[desc ? sorted.length - 1 : 0].id)}>
            <BookOpen size={12} strokeWidth={2} /> Commencer
          </button>
        </div>
      </div>
      <ol className="pb-2">
        {sorted.map((chap) => {
          const kind = kindOf(chap.folderPath)
          return (
            <li key={chap.id}>
              <button
                className="w-full flex items-center gap-3 px-4 sm:px-5 py-3 sm:py-2.5 text-left transition-colors border-t hover:bg-[var(--surface2)]"
                style={{ borderColor: 'var(--border)' }}
                onClick={() => onRead(chap.id)}
              >
                <span className="text-[12px] font-mono w-10 flex-shrink-0" style={{ color: 'var(--text3)' }}>
                  #{formatNumber(chap.chapterNumber)}
                </span>
                <span className="flex-1 min-w-0 text-[13px] truncate" style={{ color: 'var(--text)' }}>
                  {chap.title || `Chapitre ${formatNumber(chap.chapterNumber)}`}
                </span>
                {kind !== 'images' && (
                  <span className="badge text-[10px] flex items-center gap-1" style={{ background: 'var(--surface2)', color: 'var(--text3)' }}>
                    {kind === 'pdf' ? <FileText size={10} /> : <Package size={10} />} {kind === 'pdf' ? 'PDF' : 'CBZ'}
                  </span>
                )}
                {chap.pageCount ? (
                  <span className="text-[11px] font-mono flex-shrink-0" style={{ color: 'var(--text3)' }}>{chap.pageCount} p.</span>
                ) : null}
                <ChevronRight size={13} strokeWidth={2} style={{ color: 'var(--text3)', flexShrink: 0 }} />
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
