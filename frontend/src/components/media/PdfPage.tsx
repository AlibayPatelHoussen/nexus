import { useEffect, useRef, useState } from 'react'
import type { PdfDocument } from '@/hooks/usePdfDocument'
import Spinner from '@/components/ui/Spinner'

interface Props {
  pdf:     PdfDocument
  /** 1-based page number */
  n:       number
  /** Render right away (page mode) instead of when it nears the screen */
  eager?:  boolean
  className?: string
  style?:  React.CSSProperties
}

/** One PDF page: a placeholder with the page's proportions, drawn when it comes near the screen. */
export default function PdfPage({ pdf, n, eager, className, style }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(!!eager)

  useEffect(() => {
    if (eager) { setVisible(true); return }
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect() } }, { rootMargin: '150% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [eager, n])

  const { render } = pdf   // stable for a given document
  useEffect(() => {
    if (!visible) return
    let alive = true
    setFailed(false)
    render(n).then((u) => { if (alive) setSrc(u) }, () => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [visible, n, render])

  if (src) return <img src={src} alt={`Page ${n}`} className={className} style={style} draggable={false} />
  return (
    <div ref={ref} className={`grid place-items-center bg-white/5 ${className ?? ''}`} style={{ ...style, aspectRatio: String(pdf.ratio(n)) }} aria-label={`Page ${n}`}>
      {failed ? <span className="text-[13px] text-white/60">Page {n} illisible</span> : visible ? <Spinner size={22} color="rgba(255,255,255,.7)" /> : null}
    </div>
  )
}
