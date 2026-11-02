import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** Small "Copier" button (clipboard API with a fallback for non-secure contexts). */
export default function CopyButton({ command }: { command: string }) {
  const [done, setDone] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(command)
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement('textarea')
      ta.value = command; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove()
    }
    setDone(true); setTimeout(() => setDone(false), 2000)
  }
  return (
    <button className="btn-ghost text-[11.5px] px-2.5 py-1 flex-shrink-0" onClick={copy}>
      {done ? <><Check size={12} /> Copié</> : <><Copy size={12} /> Copier</>}
    </button>
  )
}
