import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useTerminalSocket } from '@/hooks/useSocket'

export default function TerminalPage() {
  const termRef  = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xtermRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitRef   = useRef<any>(null)
  const { connect, send, resize, disconnect } = useTerminalSocket()
  const [connected,   setConnected]   = useState(false)
  const [fullscreen,  setFullscreen]  = useState(false)

  useEffect(() => {
    let mounted = true
    let ro: ResizeObserver | null = null

    async function init() {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
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
        fontSize:    13,
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
      resize(term.cols, term.rows)
      setTimeout(() => send('\x0c'), 600)

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
    <div className={`flex flex-col ${fullscreen ? 'fixed inset-0 z-50' : 'h-full'}`}
      style={{ background: '#09090e' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b flex-shrink-0"
        style={{ background: '#111118', borderColor: 'rgba(255,255,255,0.07)' }}>
        <div className="flex items-center gap-2.5">
          {/* macOS dots */}
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full cursor-pointer" style={{ background: '#f75a5a' }} onClick={disconnect} />
            <div className="w-3 h-3 rounded-full" style={{ background: '#f7d04f' }} />
            <div className="w-3 h-3 rounded-full" style={{ background: '#3ecf6e' }} />
          </div>
          <span className="text-[11px] font-mono" style={{ color: 'rgba(255,255,255,0.3)' }}>
            houssen@nexus — bash
          </span>
          <div className="w-1.5 h-1.5 rounded-full"
            style={{
              background: connected ? '#3ecf6e' : '#f75a5a',
              boxShadow:  connected ? '0 0 4px #3ecf6e' : 'none',
            }} />
        </div>
        <div className="flex items-center gap-1">
          <div
            className="w-[26px] h-[26px] rounded-lg flex items-center justify-center cursor-pointer transition-colors"
            style={{ background: 'rgba(255,255,255,0.05)' }}
            onClick={toggleFullscreen}
          >
            {fullscreen
              ? <Minimize2 size={12} strokeWidth={2} color="rgba(255,255,255,0.4)" />
              : <Maximize2 size={12} strokeWidth={2} color="rgba(255,255,255,0.4)" />
            }
          </div>
        </div>
      </div>

      {/* Terminal area */}
      <div ref={termRef} className="flex-1 overflow-hidden" style={{ padding: '6px 4px' }} />
    </div>
  )
}
