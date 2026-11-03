import { useEffect, useRef, useState } from 'react'
import Spinner from '@/components/ui/Spinner'

interface Props {
  /** Returns the page's image URL (device cache first, then the network / PDF.js) */
  load:    () => Promise<string>
  /** 1-based page number (alt text) */
  n:       number
  /** Width / height for the placeholder (unknown: tall manga page) */
  ratio?:  number
  /** Load right away (page mode) instead of when it nears the screen */
  eager?:  boolean
  /** Revoke the object URL when the page goes away (URLs this page created) */
  revoke?: boolean
  className?: string
  style?:  React.CSSProperties
}

/** One page of a chapter: placeholder with the page's proportions, loaded when it comes near the screen. */
export default function ReaderPage({ load, n, ratio, eager, revoke, className, style }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(!!eager)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    if (eager) { setVisible(true); return }
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect() } }, { rootMargin: '150% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [eager, n])

  useEffect(() => {
    if (!visible) return
    let alive = true
    let made: string | null = null
    setFailed(false)
    loadRef.current().then((u) => { made = u; if (alive) setSrc(u); else if (revoke) URL.revokeObjectURL(u) }, () => { if (alive) setFailed(true) })
    return () => { alive = false; if (revoke && made) URL.revokeObjectURL(made) }
  }, [visible, n, revoke])

  if (src) return <img src={src} alt={`Page ${n}`} className={className} style={style} draggable={false} />
  return (
    <div ref={ref} className={`grid place-items-center bg-white/5 ${className ?? ''}`} style={{ ...style, aspectRatio: String(ratio ?? 0.68) }} aria-label={`Page ${n}`}>
      {failed ? <span className="text-[13px] text-white/60">Page {n} illisible</span> : visible ? <Spinner size={22} color="rgba(255,255,255,.7)" /> : null}
    </div>
  )
}
