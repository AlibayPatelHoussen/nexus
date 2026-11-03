import { useEffect, useRef, useState } from 'react'
import { ClipboardPaste, Copy, Maximize2, Minimize2, Minus, Plus, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Terminal as XTerm } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { useTerminalSocket, type TerminalInfo } from '@/hooks/useSocket'
import { useConfirm } from '@/components/ui/useConfirm'

// Keys missing from mobile on-screen keyboards
const MOBILE_KEYS: { label: string; seq: string }[] = [
  { label: 'Esc',    seq: '\x1b' },
  { label: 'Tab',    seq: '\t' },
  { label: 'Ctrl+C', seq: '\x03' },
  { label: 'Ctrl+D', seq: '\x04' },
  { label: 'Ctrl+L', seq: '\x0c' },
  { label: 'Ctrl+R', seq: '\x12' },
  { label: '↑',      seq: '\x1b[A' },
  { label: '↓',      seq: '\x1b[B' },
  { label: '←',      seq: '\x1b[D' },
  { label: '→',      seq: '\x1b[C' },
  { label: '|',      seq: '|' },
  { label: '~',      seq: '~' },
  { label: '/',      seq: '/' },
  { label: '-',      seq: '-' },
]

const SESSION_KEY = 'nexus-terminal-session'
const FONT_KEY    = 'nexus-terminal-font'

function store(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key)
    localStorage.setItem(key, value)
  } catch { /* private mode */ }
  return value ?? null
}

function newSessionId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); ta.remove()
    return ok
  }
}

type Status = 'connecting' | 'connected' | 'disconnected' | 'detached' | 'ended'

export default function TerminalPage() {
  const termRef    = useRef<HTMLDivElement>(null)
  const xtermRef   = useRef<XTerm | null>(null)
  const fitRef     = useRef<FitAddon | null>(null)
  const sessionRef = useRef<string>(store(SESSION_KEY) || newSessionId())
  const { connect, reconnect, send, resize, closeSession, disconnect } = useTerminalSocket()
  const confirm = useConfirm()
  const [status,     setStatus]     = useState<Status>('connecting')
  const [info,       setInfo]       = useState<TerminalInfo | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [fontSize,   setFontSize]   = useState(() => Number(store(FONT_KEY)) || (window.innerWidth < 640 ? 12 : 14))
  const statusRef = useRef<Status>('connecting')
  const setStat = (s: Status) => { statusRef.current = s; setStatus(s) }

  useEffect(() => {
    let mounted = true
    let ro: ResizeObserver | null = null

    async function init() {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }, { Unicode11Addon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
        import('@xterm/addon-unicode11'),
        // @ts-expect-error — CSS module lacks type declarations
        import('@xterm/xterm/css/xterm.css'),
      ])
      if (!mounted || !termRef.current) return

      const term = new Terminal({
        theme: {
          background: '#09090e', foreground: '#e8e8f0', cursor: '#f0f0f8', selectionBackground: '#4f8ef766',
          black: '#1c1c1e', red: '#f75a5a', green: '#3ecf6e', yellow: '#f7d04f', blue: '#4f8ef7',
          magenta: '#a78bfa', cyan: '#4fd1c5', white: '#e8e8f0',
          brightBlack: '#5a5a72', brightRed: '#ff7b7b', brightGreen: '#5be38a', brightYellow: '#ffe27a',
          brightBlue: '#78a9ff', brightMagenta: '#c4a8ff', brightCyan: '#7ee8de', brightWhite: '#ffffff',
        },
        fontFamily:  '"Geist Mono", "Cascadia Code", "DejaVu Sans Mono", monospace',
        fontSize,
        lineHeight:  1.2,
        cursorBlink: true,
        scrollback:  10000,
        allowProposedApi: true,
        macOptionIsMeta: true,
        rightClickSelectsWord: true,
      })

      const fit = new FitAddon()
      term.loadAddon(fit)
      term.loadAddon(new WebLinksAddon((_e, url) => window.open(url, '_blank', 'noopener')))
      const unicode = new Unicode11Addon()
      term.loadAddon(unicode)
      term.unicode.activeVersion = '11'
      term.open(termRef.current)
      fit.fit()
      xtermRef.current = term
      fitRef.current   = fit

      // Ctrl+Shift+C / Ctrl+Shift+V (Ctrl+C stays "interrupt", as in any terminal)
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true
        if (e.code === 'KeyC') { if (term.hasSelection()) void copyText(term.getSelection()); return false }
        if (e.code === 'KeyV') { void navigator.clipboard?.readText().then((t) => t && term.paste(t)).catch(() => {}); return false }
        return true
      })

      connect({
        sessionId: () => sessionRef.current,
        size:      () => ({ cols: term.cols, rows: term.rows }),
        onReady:   (i) => {
          setInfo(i); setStat('connected')
          sessionRef.current = i.sessionId
          store(SESSION_KEY, i.sessionId)
          if (!i.resumed) term.reset()
          term.focus()
        },
        onOutput:  (data) => term.write(data),
        onReplay:  (data) => { term.reset(); term.write(data) },
        onExit:    (code) => {
          term.write(`\r\n\x1b[33m[Session terminée — code ${code}]\x1b[0m\r\n`)
          setStat('ended')
        },
        onStatus:  (s) => { if (statusRef.current !== 'ended' || s === 'connected') setStat(s) },
      })

      term.onData((data) => send(data))
      term.onResize(({ cols, rows }) => resize(cols, rows))

      ro = new ResizeObserver(() => { try { fit.fit() } catch { /* hidden */ } })
      ro.observe(termRef.current)
    }

    init()
    return () => {
      mounted = false
      ro?.disconnect()
      xtermRef.current?.dispose()
      // Only detaches: the shell keeps running on the server
      disconnect()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const term = xtermRef.current
    if (!term) return
    term.options.fontSize = fontSize
    store(FONT_KEY, String(fontSize))
    setTimeout(() => fitRef.current?.fit(), 0)
  }, [fontSize])

  function newSession() {
    sessionRef.current = newSessionId()
    store(SESSION_KEY, sessionRef.current)
    xtermRef.current?.reset()
    setStat('connecting')
    reconnect()
  }

  async function reset() {
    if (status === 'ended') { newSession(); return }
    const ok = await confirm({
      title:   'Réinitialiser le terminal ?',
      message: 'Le shell en cours est fermé (les commandes qui tournent dedans sont arrêtées) et un nouveau est ouvert.',
      confirmLabel: 'Réinitialiser',
      danger: true,
    })
    if (!ok) return
    closeSession()
    setTimeout(newSession, 200)
  }

  async function copySelection() {
    const sel = xtermRef.current?.getSelection()
    if (!sel) { toast('Sélectionne du texte dans le terminal'); return }
    if (await copyText(sel)) toast.success('Copié')
    xtermRef.current?.focus()
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText()
      if (text) xtermRef.current?.paste(text)
    } catch { toast('Utilise Ctrl+Shift+V (ou appui long → Coller)') }
    xtermRef.current?.focus()
  }

  function toggleFullscreen() {
    setFullscreen((f) => !f)
    setTimeout(() => fitRef.current?.fit(), 120)
  }

  const statusColor = status === 'connected' ? '#3ecf6e' : status === 'connecting' ? '#f7d04f' : '#f75a5a'
  const statusText  = {
    connecting: 'Connexion…', connected: 'Connecté', disconnected: 'Reconnexion…',
    detached: 'Ouvert ailleurs', ended: 'Terminé',
  }[status]
  const btn = 'h-8 sm:h-7 min-w-8 sm:min-w-7 px-1.5 rounded-lg flex items-center justify-center gap-1 text-[11px] transition-colors hover:bg-white/10'

  return (
    <div className={`flex flex-col ${fullscreen ? 'fixed inset-0 z-50 h-[100dvh]' : 'h-full'}`} style={{ background: '#09090e' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 border-b flex-shrink-0"
        style={{ background: '#111118', borderColor: 'rgba(255,255,255,0.07)', paddingTop: fullscreen ? 'max(0.5rem, env(safe-area-inset-top))' : undefined }}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: statusColor, boxShadow: status === 'connected' ? `0 0 5px ${statusColor}` : 'none' }} />
          <span className="text-[12px] font-mono truncate" style={{ color: 'rgba(255,255,255,0.6)' }} data-testid="terminal-title">
            {info ? `${info.user}@${info.host}` : 'terminal'}
          </span>
          <span className="hidden sm:inline text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{statusText}</span>
        </div>
        <div className="flex items-center gap-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
          <button className={btn} onClick={() => setFontSize((f) => Math.max(9, f - 1))} aria-label="Réduire le texte"><Minus size={13} /></button>
          <span className="text-[11px] font-mono w-5 text-center hidden sm:inline">{fontSize}</span>
          <button className={btn} onClick={() => setFontSize((f) => Math.min(28, f + 1))} aria-label="Agrandir le texte"><Plus size={13} /></button>
          <span className="w-px h-4 mx-1" style={{ background: 'rgba(255,255,255,0.1)' }} />
          <button className={btn} onClick={copySelection} aria-label="Copier la sélection" title="Copier (Ctrl+Shift+C)"><Copy size={13} /></button>
          <button className={btn} onClick={paste} aria-label="Coller" title="Coller (Ctrl+Shift+V)"><ClipboardPaste size={13} /></button>
          <button className={btn} onClick={reset} aria-label="Réinitialiser le terminal" title="Réinitialiser">
            <RotateCcw size={13} /><span className="hidden md:inline">Réinitialiser</span>
          </button>
          <button className={btn} onClick={toggleFullscreen} aria-label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}>
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* Terminal area */}
      <div className="relative flex-1 min-h-0">
        <div ref={termRef} className="absolute inset-0 overflow-hidden" style={{ padding: '6px 4px 4px 8px' }} />
        {(status === 'ended' || status === 'detached') && (
          <div className="absolute inset-x-0 bottom-4 flex justify-center pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-2.5 text-[13px]"
              style={{ background: '#1a1a24', color: '#e8e8f0', boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}>
              {status === 'ended' ? 'La session est terminée.' : 'Ce terminal est ouvert dans un autre onglet.'}
              <button className="btn-primary text-[12px] py-1.5" onClick={status === 'ended' ? newSession : reconnect}>
                {status === 'ended' ? 'Nouvelle session' : 'Reprendre ici'}
              </button>
            </div>
          </div>
        )}
      </div>

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
