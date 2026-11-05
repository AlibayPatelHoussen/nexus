import { useEffect, useState } from 'react'
import { cn } from '@/utils'

/**
 * The title as Apple TV shows it: the show's own logo (transparent PNG from
 * TMDB) when there is one, otherwise the title in big bold type.
 */
export default function TitleLogo({ title, logo, className, logoClassName }: {
  title: string; logo?: string | null; className?: string; logoClassName?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [logo])
  if (logo && !failed) {
    return (
      <img
        data-logo
        src={logo}
        alt={title}
        draggable={false}
        onError={() => setFailed(true)}
        className={cn('object-contain [filter:drop-shadow(0_2px_14px_rgba(0,0,0,0.35))]', logoClassName)}
      />
    )
  }
  return <span className={className}>{title}</span>
}
