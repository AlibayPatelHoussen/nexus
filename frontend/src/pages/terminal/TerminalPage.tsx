import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useTerminalSocket } from '@/hooks/useSocket'
import { useAuthStore } from '@/stores/authStore'

// Keys missing from mobile on-screen keyboards
const MOBILE_KEYS: { label: string; seq: string }[] = [
  { label: 'Esc',    seq: '\x1b' },
  { label: 'Tab',    seq: '\t' },
  { label: 'Ctrl+C', seq: '\x03' },
  { label: 'Ctrl+D', seq: '\x04' },
  { label: 'Ctrl+L', seq: '\x0c' },
  { label: '↑',      seq: '\x1b[A' },
  { label: '↓',      seq: '\x1b[B' },
  { label: '←',      seq: '\x1b[D' },
  { label: '→',      seq: '\x1b[C' },
  { label: '|',      seq: '|' },
  { label: '~',      seq: '~' },
  { label: '/',      seq: '/' },
]

export default function TerminalPage() {
  const termRef  = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xtermRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitRef   = useRef<any>(null)
  const { connect, send, resize, disconnect } = useTerminalSocket()
  const [connected,   setConnected]   = useState(false)
  const [fullscreen,  setFullscreen]  = useState(false)
  const username = useAuthStore((s) => s.user?.username) || 'nexus'

  useEffect(() => {
    let mounted = true
    let ro: ResizeObserver | null = null

    async function init() {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        // @ts-expect-error — CSS module lacks type declarations
        import('@xterm/xterm/css/xterm.css'),
      ])
      if (!mounted || !termRef.current) return

      const term = new Terminal({
        theme: {
          background: '#09090e',
          foreground: '#f0f0f8',
          cursor:     '#f0f0f8',
          black:      '#1c1c1e', red:    '#f75a5a', green:  '#3ecf6e',
          yellow:     '#f7d04f', blue:   '#4f8ef7', magenta:'#a78bfa',
          cyan:       '#4fd1c5', white:  '#f0f0f8', brightBlack: '#5a5a72',
        },
        fontFamily:  '"Geist Mono", "Cascadia Code", monospace',
        fontSize:    window.innerWidth < 640 ? 11.5 : 13,
        lineHeight:  1.5,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback:  5000,
      })

      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(termRef.current)
      fit.fit()

      xtermRef.current = term
      fitRef.current   = fit

      connect(
        (data) => term.write(data),
        (code) => {
          term.write(`\r\n\x1b[33m[Session terminée — code ${code}]\x1b[0m\r\n`)
          setConnected(false)
        },
      )
      setConnected(true)
      setTimeout(() => send('\x0c'), 800)

      term.onData((data) => send(data))

      ro = new ResizeObserver(() => {
        fit.fit()
        resize(term.cols, term.rows)
      })
      if (termRef.current) ro.observe(termRef.current)
    }

    init()
    return () => {
      mounted = false
      ro?.disconnect()
      xtermRef.current?.dispose()
      disconnect()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleFullscreen() {
    setFullscreen((f) => !f)
    setTimeout(() => fitRef.current?.fit(), 120)
  }

  return (
    <div className={`flex flex-col ${fullscreen ? 'fixed inset-0 z-50 h-[100dvh]' : 'h-full'}`}
      style={{ background: '#09090e' }}>

      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b flex-shrink-0"
        style={{ background: '#111118', borderColor: 'rgba(255,255,255,0.07)', paddingTop: fullscreen ? 'max(0.625rem, env(safe-area-inset-top))' : undefined }}>
        <div className="flex items-center gap-2.5 min-w-0">
          {/* macOS dots */}
          <div className="flex gap-1.5 flex-shrink-0">
            <div className="w-3 h-3 rounded-full cursor-pointer" style={{ background: '#f75a5a' }} onClick={disconnect} />
            <div className="w-3 h-3 rounded-full" style={{ background: '#f7d04f' }} />
            <div className="w-3 h-3 rounded-full" style={{ background: '#3ecf6e' }} />
          </div>
          <span className="text-[11px] font-mono truncate" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {username}@nexus — bash
          </span>
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{
              background: connected ? '#3ecf6e' : '#f75a5a',
              boxShadow:  connected ? '0 0 4px #3ecf6e' : 'none',
            }} />
        </div>
        <div className="flex items-center gap-1">
          <button
            className="w-8 h-8 sm:w-[26px] sm:h-[26px] rounded-lg flex items-center justify-center cursor-pointer transition-colors"
            style={{ background: 'rgba(255,255,255,0.05)' }}
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}
          >
            {fullscreen
              ? <Minimize2 size={12} strokeWidth={2} color="rgba(255,255,255,0.4)" />
              : <Maximize2 size={12} strokeWidth={2} color="rgba(255,255,255,0.4)" />
            }
          </button>
        </div>
      </div>

      {/* Terminal area */}
      <div ref={termRef} className="flex-1 min-h-0 overflow-hidden" style={{ padding: '6px 4px' }} />

      {/* Extra keys for touch keyboards */}
      <div
        className="md:hidden flex gap-1.5 px-2 py-2 overflow-x-auto border-t flex-shrink-0"
        style={{ background: '#111118', borderColor: 'rgba(255,255,255,0.07)', paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        {MOBILE_KEYS.map((k) => (
          <button
            key={k.label}
            className="px-3 h-9 rounded-md text-[12px] font-mono flex-shrink-0 active:scale-95 transition-transform"
            style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.8)' }}
            // Keep focus (and the soft keyboard) on the terminal
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { send(k.seq); xtermRef.current?.focus() }}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  )
}
