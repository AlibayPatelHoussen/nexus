import { useEffect, useRef, useState } from 'react'
import { ClipboardPaste, Copy, Ellipsis, Maximize2, Minimize2, Minus, Plus, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Terminal as XTerm } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { useTerminalSocket, type TerminalInfo } from '@/hooks/useSocket'
import { useConfirm } from '@/components/ui/useConfirm'
import Page from '@/components/shell/Page'
import { useShell } from '@/components/shell/shellContext'
import { useCoarsePointer } from '@/hooks/useDevice'
import { useContextMenu } from '@/components/ui/useContextMenu'
import Button from '@/components/ui/Button'
import { cn } from '@/utils'

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

const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'

// ANSI colours tuned on Apple's system colours, readable on each background
const ANSI_LIGHT = {
  black: '#1d1d1f', red: '#c4261d', green: '#1e7b34', yellow: '#946200', blue: '#0058d0', magenta: '#a42ea8', cyan: '#0b7a85', white: '#8e8e93',
  brightBlack: '#6e6e73', brightRed: '#d70015', brightGreen: '#248a3d', brightYellow: '#b25000', brightBlue: '#0071e3', brightMagenta: '#b143c6', brightCyan: '#0d8a96', brightWhite: '#3a3a3c',
}
const ANSI_DARK = {
  black: '#545458', red: '#ff6961', green: '#30d158', yellow: '#ffd60a', blue: '#409cff', magenta: '#da8fff', cyan: '#70d7ff', white: '#e5e5e7',
  brightBlack: '#8e8e93', brightRed: '#ff8a80', brightGreen: '#5be27d', brightYellow: '#ffe55c', brightBlue: '#6eb6ff', brightMagenta: '#e5a8ff', brightCyan: '#9ae6ff', brightWhite: '#ffffff',
}

/** xterm theme from the current appearance (tokens --term-*) */
function terminalTheme() {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string) => css.getPropertyValue(n).trim()
  const dark = css.colorScheme === 'dark' || v('color-scheme') === 'dark'
  return {
    background: v('--term-bg'), foreground: v('--term-fg'), cursor: v('--term-cursor'), cursorAccent: v('--term-bg'),
    selectionBackground: v('--term-select'),
    ...(dark ? ANSI_DARK : ANSI_LIGHT),
  }
}

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
  const [fontSize,   setFontSize]   = useState(() => Number(store(FONT_KEY)) || (window.innerWidth < 640 ? 12 : 13))
  const menu = useContextMenu()
  const { device } = useShell()
  const phone = device === 'phone'
  const coarse = useCoarsePointer()
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
        import('@xterm/xterm/css/xterm.css'),
      ])
      if (!mounted || !termRef.current) return

      const term = new Terminal({
        theme: terminalTheme(),
        fontFamily:  MONO,
        fontSize,
        lineHeight:  1.15,
        cursorBlink: true,
        cursorStyle: 'block',
        cursorInactiveStyle: 'outline',
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

  // Follow Auto / Clair / Sombre
  useEffect(() => {
    const apply = () => { if (xtermRef.current) xtermRef.current.options.theme = terminalTheme() }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const mo = new MutationObserver(apply)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    mq.addEventListener('change', apply)
    return () => { mo.disconnect(); mq.removeEventListener('change', apply) }
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

  const statusText = {
    connecting: 'Connexion…', connected: 'Connecté', disconnected: 'Reconnexion…',
    detached: 'Ouvert dans un autre onglet', ended: 'Session terminée',
  }[status]
  const where = info ? `${info.user}@${info.host}` : 'Terminal'
  const smaller = () => setFontSize((f) => Math.max(9, f - 1))
  const bigger  = () => setFontSize((f) => Math.min(28, f + 1))
  const icon = 'w-8 h-8 grid place-items-center rounded-full text-label2 hoverable disabled:opacity-40'

  const actions = phone ? (
    <button type="button" className="w-11 h-11 grid place-items-center text-accent-text active:opacity-50" aria-haspopup="menu" aria-label="Options du terminal"
      onClick={(e) => menu.openFrom(e.currentTarget, [
        { label: 'Copier la sélection', icon: <Copy />, onSelect: copySelection },
        { label: 'Coller', icon: <ClipboardPaste />, onSelect: paste },
        { separator: true },
        { label: 'Agrandir le texte', icon: <Plus />, onSelect: bigger },
        { label: 'Réduire le texte', icon: <Minus />, onSelect: smaller },
        { label: fullscreen ? 'Quitter le plein écran' : 'Plein écran', icon: fullscreen ? <Minimize2 /> : <Maximize2 />, onSelect: toggleFullscreen },
        { separator: true },
        { label: status === 'ended' ? 'Nouvelle session' : 'Réinitialiser', icon: <RotateCcw />, onSelect: reset, destructive: status !== 'ended' },
      ], `${where} · ${statusText}`)}>
      <Ellipsis size={24} strokeWidth={1.75} />
    </button>
  ) : (
    <>
      <div className="flex items-center rounded-[7px] bg-fill" role="group" aria-label="Taille du texte">
        <button type="button" className={cn(icon, 'rounded-r-none')} onClick={smaller} aria-label="Réduire le texte" title="Réduire le texte"><Minus size={14} strokeWidth={1.75} /></button>
        <span className="w-6 text-center text-caption text-label2 tabular" aria-live="polite">{fontSize}</span>
        <button type="button" className={cn(icon, 'rounded-l-none')} onClick={bigger} aria-label="Agrandir le texte" title="Agrandir le texte"><Plus size={14} strokeWidth={1.75} /></button>
      </div>
      <button type="button" className={icon} onClick={copySelection} aria-label="Copier la sélection" title="Copier (Ctrl+Maj+C)"><Copy size={16} strokeWidth={1.5} /></button>
      <button type="button" className={icon} onClick={paste} aria-label="Coller" title="Coller (Ctrl+Maj+V)"><ClipboardPaste size={16} strokeWidth={1.5} /></button>
      <button type="button" className={icon} onClick={reset} aria-label="Réinitialiser le terminal" title="Réinitialiser"><RotateCcw size={16} strokeWidth={1.5} /></button>
      <button type="button" className={icon} onClick={toggleFullscreen} aria-label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'} title={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}>
        {fullscreen ? <Minimize2 size={16} strokeWidth={1.5} /> : <Maximize2 size={16} strokeWidth={1.5} />}
      </button>
    </>
  )

  const surface = (
    <div className={cn('flex flex-col min-h-0', fullscreen ? 'fixed inset-0 z-[60]' : 'flex-1')} style={{ background: 'var(--term-bg)' }}>
      {fullscreen && (
        <div className="flex items-center justify-between gap-2 px-3 material-bar hairline-b flex-shrink-0" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', minHeight: 'calc(44px + env(safe-area-inset-top, 0px))' }}>
          <span className="text-subhead text-label2 font-mono truncate" data-testid="terminal-title">{where}</span>
          <Button variant="plain" onClick={toggleFullscreen}>Terminé</Button>
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        <div ref={termRef} className="absolute inset-0 overflow-hidden" style={{ padding: '8px 4px 4px 12px' }} />
        {(status === 'ended' || status === 'detached') && (
          <div className="absolute inset-x-0 bottom-4 flex justify-center pointer-events-none px-4">
            <div role="status" className="pointer-events-auto flex items-center gap-3 rounded-[12px] material-bar px-4 py-2.5 text-body" style={{ boxShadow: 'var(--shadow-popover)' }}>
              <span className="text-label">{status === 'ended' ? 'La session est terminée.' : 'Ce terminal est ouvert dans un autre onglet.'}</span>
              <Button variant="primary" size="small" onClick={status === 'ended' ? newSession : reconnect}>
                {status === 'ended' ? 'Nouvelle session' : 'Reprendre ici'}
              </Button>
            </div>
          </div>
        )}
      </div>
      {/* Keys missing from touch keyboards (keyboard accessory bar) */}
      {coarse && (
        <div className="flex gap-1.5 px-2 py-1.5 overflow-x-auto scrollbar-none material-bar hairline-t flex-shrink-0" style={{ paddingBottom: fullscreen ? 'max(6px, env(safe-area-inset-bottom, 0px))' : 6 }}>
          {MOBILE_KEYS.map((k) => (
            <button
              key={k.label}
              type="button"
              className="px-3 min-w-[44px] h-[38px] rounded-[6px] text-[15px] font-mono text-label flex-shrink-0 active:opacity-60"
              style={{ background: 'var(--seg-on)', boxShadow: '0 1px 0 rgba(0,0,0,.25)' }}
              // Keep focus (and the soft keyboard) on the terminal
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { send(k.seq); xtermRef.current?.focus() }}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <>
      <div
        className="flex flex-col"
        style={{ height: phone ? 'calc(100dvh - var(--tabbar-h) - env(safe-area-inset-bottom, 0px))' : '100%' }}
      >
        <Page
          title="Terminal"
          subtitle={<span className="inline-flex items-center gap-1.5"><span className="font-mono" data-testid={fullscreen ? undefined : 'terminal-title'}>{where}</span><span aria-hidden="true">·</span><span>{statusText}</span></span>}
          actions={actions}
          bleed
          largeTitle={false}
        >
          <div className="flex flex-col h-full">{surface}</div>
        </Page>
      </div>
      {menu.element}
    </>
  )
}
