import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowUp, Bot, Mic, ShieldCheck, SquarePen, Volume2, VolumeX, Wrench } from 'lucide-react'
import toast from 'react-hot-toast'
import Page from '@/components/shell/Page'
import { useShell } from '@/components/shell/shellContext'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { spring } from '@/design/motion'
import { cn } from '@/utils'
import { serverError } from '@/utils/errorToast'
import { useAuthStore } from '@/stores/authStore'
import {
  describeAction, jarvisService, speechText, splitLinks, type JarvisApproval, type JarvisEvent,
} from '@/services/jarvisService'

/** One line of the conversation as shown on screen. */
type Item =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'assistant'; id: number; text: string; streaming?: boolean }
  | { kind: 'tool'; id: number; name: string; args: Record<string, unknown> }
  | { kind: 'confirm'; id: number; confirmId: string; action: string; answer?: boolean }
  | { kind: 'notice'; id: number; text: string; tone?: 'error' }
/** Omit applied to each kind of the union (plain Omit would merge them). */
type NewItem = Item extends infer T ? (T extends Item ? Omit<T, 'id'> : never) : never

const SUGGESTIONS = [
  'Comment va le serveur ?',
  'Quelles sont mes tâches ?',
  'Rappelle-moi de sortir les poubelles à 20 h',
  'Quels conteneurs tournent ?',
]

const SPEAK_KEY = 'nexus_jarvis_speak'

// Speech recognition is not in the TypeScript DOM types yet
interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
type RecognitionCtor = new () => Recognition
const RecognitionImpl: RecognitionCtor | undefined = typeof window === 'undefined'
  ? undefined
  : (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition

function readSpeakPref(): boolean {
  try { return localStorage.getItem(SPEAK_KEY) === 'on' } catch { return false }
}

function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(speechText(text))
  utterance.lang = 'fr-FR'
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang?.startsWith('fr'))
  if (voice) utterance.voice = voice
  window.speechSynthesis.speak(utterance)
}

function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

/** Minimal markdown: code blocks, inline code, bold. Text is never injected as HTML. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const code = part.slice(3, -3).replace(/^[a-zA-Z0-9]*\n/, '')
          return <pre key={i} className="my-1.5 p-2.5 rounded-control bg-fill font-mono text-caption overflow-x-auto whitespace-pre">{code}</pre>
        }
        return (
          <span key={i}>
            {part.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((piece, j) => {
              if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2) {
                return <code key={j} className="font-mono text-[0.92em] px-1 rounded bg-fill">{piece.slice(1, -1)}</code>
              }
              if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) {
                return <strong key={j} className="font-semibold">{piece.slice(2, -2)}</strong>
              }
              return splitLinks(piece).map((p, k) => typeof p === 'string' ? p
                : p.internal
                  ? <Link key={`${j}-${k}`} to={p.href} className="text-accent-text font-medium underline underline-offset-2">{p.label}</Link>
                  : <a key={`${j}-${k}`} href={p.href} target="_blank" rel="noopener noreferrer" className="text-accent-text underline underline-offset-2">{p.label}</a>)
            })}
          </span>
        )
      })}
    </>
  )
}

export default function JarvisPage() {
  const { device } = useShell()
  const phone = device === 'phone'
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const qc = useQueryClient()

  const { data: status } = useQuery({
    queryKey: ['jarvis', 'status'],
    queryFn:  jarvisService.status,
    refetchInterval: 60_000,
  })
  const ready = !!status?.configured && status.online
  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['jarvis', 'history'],
    queryFn:  jarvisService.history,
    enabled:  ready,
    staleTime: Infinity,
  })
  const { data: approvals = [] } = useQuery({
    queryKey: ['jarvis', 'approvals'],
    queryFn:  jarvisService.approvals,
    enabled:  ready,
    refetchInterval: 10_000,
  })

  const [items, setItems] = useState<Item[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [speakOn, setSpeakOn] = useState(readSpeakPref)
  const nextId = useRef(1)
  const scroller = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const recognition = useRef<Recognition | null>(null)
  const loaded = useRef(false)

  const push = useCallback((item: NewItem) => {
    const id = nextId.current++
    setItems((all) => [...all, { ...item, id } as Item])
    return id
  }, [])

  // Conversation kept by Jarvis (survives a reload)
  useEffect(() => {
    if (!history || loaded.current) return
    loaded.current = true
    setItems(history.map((m) => ({ kind: m.role, id: nextId.current++, text: m.content })))
  }, [history])

  // Stay at the bottom while the answer arrives
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }, [items, approvals.length])

  useEffect(() => () => { stopSpeaking(); recognition.current?.stop() }, [])

  const send = useCallback(async (raw: string, viaVoice = false) => {
    const text = raw.trim()
    if (!text || busy) return
    stopSpeaking()
    setBusy(true)
    push({ kind: 'user', text })
    let answerId: number | null = null
    let answer = ''
    let final = ''
    const onEvent = (e: JarvisEvent) => {
      if (e.type === 'token') {
        answer += e.text
        if (answerId === null) answerId = push({ kind: 'assistant', text: answer, streaming: true })
        const id = answerId
        const current = answer
        setItems((all) => all.map((it) => (it.id === id ? { ...it, text: current } as Item : it)))
      } else if (e.type === 'tool') {
        // A tool after some text: the next text goes in a new bubble
        if (answerId !== null) {
          const id = answerId
          setItems((all) => all.map((it) => (it.id === id ? { ...it, streaming: false } as Item : it)))
          answerId = null
          answer = ''
        }
        push({ kind: 'tool', name: e.name, args: e.arguments })
      } else if (e.type === 'confirm') {
        push({ kind: 'confirm', confirmId: e.id, action: e.action })
      } else if (e.type === 'done') {
        final = e.response
      } else if (e.type === 'error') {
        push({ kind: 'notice', text: e.message, tone: 'error' })
      }
    }
    try {
      await jarvisService.chat(text, onEvent)
    } catch (err) {
      push({ kind: 'notice', text: serverError(err), tone: 'error' })
    } finally {
      setItems((all) => all.map((it) => (it.kind === 'assistant' && it.streaming ? { ...it, streaming: false } : it)))
      setBusy(false)
      if (final && (viaVoice || readSpeakPref())) speak(final)
      if (!viaVoice && !phone) textarea.current?.focus()
      qc.invalidateQueries({ queryKey: ['jarvis', 'approvals'] })
    }
  }, [busy, phone, push, qc])

  const answerConfirm = async (item: Extract<Item, { kind: 'confirm' }>, approved: boolean) => {
    setItems((all) => all.map((it) => (it.id === item.id ? { ...item, answer: approved } : it)))
    try {
      await jarvisService.confirm(item.confirmId, approved)
    } catch (err) {
      toast.error(serverError(err))
    }
  }

  const decideApproval = async (approval: JarvisApproval, approved: boolean) => {
    try {
      const { result } = await jarvisService.decide(approval.id, approved)
      push({ kind: 'assistant', text: approved ? result : 'Action refusée.' })
    } catch (err) {
      toast.error(serverError(err))
    }
    qc.invalidateQueries({ queryKey: ['jarvis', 'approvals'] })
  }

  const clear = async () => {
    if (busy) return
    stopSpeaking()
    try {
      await jarvisService.clear()
      setItems([])
      qc.setQueryData(['jarvis', 'history'], [])
    } catch (err) {
      toast.error(serverError(err))
    }
  }

  const toggleSpeak = () => {
    const on = !speakOn
    setSpeakOn(on)
    try { localStorage.setItem(SPEAK_KEY, on ? 'on' : 'off') } catch { /* private mode */ }
    if (!on) stopSpeaking()
    toast.success(on ? 'Les réponses seront lues à voix haute' : 'Lecture à voix haute coupée')
  }

  const toggleMic = () => {
    if (!RecognitionImpl) return
    if (recognition.current) { recognition.current.stop(); return }
    stopSpeaking()
    const rec = new RecognitionImpl()
    rec.lang = 'fr-FR'
    rec.interimResults = true
    rec.continuous = false
    let finalText = ''
    let heard = ''
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = e.results[i][0].transcript
        if (e.results[i].isFinal) finalText += piece
        else interim += piece
      }
      heard = (finalText + interim).trim()
      setInput(heard)
    }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        toast.error('Micro refusé : autorise-le dans les réglages du navigateur.')
      }
    }
    rec.onend = () => {
      recognition.current = null
      setListening(false)
      if (heard) { setInput(''); send(heard, true) }
    }
    try {
      rec.start()
      recognition.current = rec
      setListening(true)
    } catch { recognition.current = null }
  }

  const iconBtn = phone
    ? 'w-11 h-11 grid place-items-center text-accent-text active:opacity-50'
    : 'w-8 h-8 grid place-items-center rounded-full text-label2 hoverable'
  const actions = ready ? (
    <div className="flex items-center gap-1">
      {'speechSynthesis' in window && (
        <button type="button" className={iconBtn} onClick={toggleSpeak} aria-pressed={speakOn}
          aria-label={speakOn ? 'Couper la lecture à voix haute' : 'Lire les réponses à voix haute'}
          title={speakOn ? 'Couper la lecture à voix haute' : 'Lire les réponses à voix haute'}>
          {speakOn ? <Volume2 size={phone ? 22 : 16} strokeWidth={phone ? 1.75 : 1.5} />
            : <VolumeX size={phone ? 22 : 16} strokeWidth={phone ? 1.75 : 1.5} />}
        </button>
      )}
      <button type="button" className={iconBtn} onClick={clear} disabled={busy}
        aria-label="Nouvelle conversation" title="Nouvelle conversation">
        <SquarePen size={phone ? 22 : 16} strokeWidth={phone ? 1.75 : 1.5} />
      </button>
    </div>
  ) : undefined

  const subtitle = !status ? undefined
    : !status.configured ? 'Non configuré'
      : !status.online ? 'Hors ligne'
        : status.warning ? 'Modèle indisponible' : status.model

  let body: React.ReactNode
  if (status && !status.configured) {
    body = (
      <EmptyState icon={<Bot strokeWidth={1.25} />} title="Jarvis n’est pas encore relié à Nexus"
        message={isAdmin
          ? <>Sur le serveur, crée une clé pour Nexus (<code className="font-mono">start.py cles ajouter nexus --role admin --confiance</code>) puis ajoute <code className="font-mono">JARVIS_API_KEY</code> dans le .env de Nexus.</>
          : 'Demande à un administrateur de le configurer.'} />
    )
  } else if (status && !status.online) {
    body = (
      <EmptyState tone="error" icon={<Bot strokeWidth={1.25} />} title="Jarvis ne répond pas"
        message={isAdmin ? <>Vérifie le service sur le serveur : <code className="font-mono">systemctl status jarvis</code></> : 'Réessaie dans un instant.'}
        action={<Button onClick={() => qc.invalidateQueries({ queryKey: ['jarvis', 'status'] })}>Réessayer</Button>} />
    )
  } else if (!status || (ready && historyLoading)) {
    body = <div className="max-w-[760px] mx-auto w-full pt-4"><SkeletonRows rows={4} /></div>
  } else {
    body = (
      <div className="max-w-[760px] mx-auto w-full flex flex-col gap-3 py-4" role="log" aria-live="polite" aria-label="Conversation avec Jarvis">
        {status.warning && (
          <p role="status" className="self-center text-subhead text-warn-text bg-fill rounded-pill px-3 py-1.5 text-center">
            {status.warning} Les commandes simples (tâches, calcul, météo) restent disponibles.
          </p>
        )}
        {items.length === 0 && (
          <div className="flex flex-col items-center">
            <EmptyState icon={<Bot strokeWidth={1.25} />} title="Bonjour, je suis Jarvis"
              message="Demande-moi l’état du serveur, une tâche, un rappel, une recherche… Je m’occupe du reste." />
            <div className="flex flex-wrap justify-center gap-2 px-4 -mt-4">
              {SUGGESTIONS.map((s) => (
                <Button key={s} size="small" onClick={() => send(s)} disabled={busy}>{s}</Button>
              ))}
            </div>
          </div>
        )}
        {items.map((item) => <Line key={item.id} item={item} onConfirm={answerConfirm} />)}
        {busy && !items.some((it) => it.kind === 'assistant' && it.streaming) && (
          <div className="self-start px-4 py-3 rounded-[20px] rounded-bl-md bg-surface flex gap-1" aria-label="Jarvis réfléchit" role="status">
            {[0, 1, 2].map((i) => (
              <span key={i} className="w-1.5 h-1.5 rounded-full bg-label3 animate-pulse motion-reduce:animate-none" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </div>
        )}
        {approvals.map((a) => <ApprovalCard key={a.id} approval={a} onDecide={decideApproval} />)}
      </div>
    )
  }

  const composer = ready && (
    <form
      className="glass glass-float rounded-pill flex items-end gap-1 p-1.5 mx-auto w-full max-w-[760px]"
      onSubmit={(e) => { e.preventDefault(); const t = input; setInput(''); send(t) }}
    >
      {RecognitionImpl && (
        <button type="button" onClick={toggleMic} aria-pressed={listening}
          aria-label={listening ? 'Arrêter l’écoute' : 'Parler à Jarvis'} title={listening ? 'Arrêter l’écoute' : 'Parler à Jarvis'}
          className={cn('w-10 h-10 flex-none grid place-items-center rounded-full transition-colors duration-fast',
            listening ? 'bg-danger text-white animate-pulse motion-reduce:animate-none' : 'text-label2 hoverable')}>
          <Mic size={20} strokeWidth={1.75} />
        </button>
      )}
      <textarea
        ref={textarea}
        value={input}
        rows={1}
        onChange={(e) => {
          setInput(e.target.value)
          e.target.style.height = 'auto'
          e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            e.currentTarget.form?.requestSubmit()
          }
        }}
        placeholder={listening ? 'Je t’écoute…' : 'Écrire à Jarvis…'}
        aria-label="Message pour Jarvis"
        enterKeyHint="send"
        className="flex-1 min-w-0 resize-none bg-transparent outline-none text-body text-label placeholder:text-label3 py-2 px-2 max-h-40 max-md:text-[17px]"
      />
      <button type="submit" disabled={busy || !input.trim()} aria-label="Envoyer" title="Envoyer"
        className="w-10 h-10 flex-none grid place-items-center rounded-full bg-accent-fill text-white disabled:opacity-40 active:opacity-80 transition-opacity duration-fast">
        <ArrowUp size={20} strokeWidth={2.25} />
      </button>
    </form>
  )

  return (
    <div className="flex flex-col"
      style={{ height: phone ? 'calc(100dvh - var(--tabbar-h) - env(safe-area-inset-bottom, 0px))' : '100%' }}>
      <Page title="Jarvis" subtitle={subtitle} actions={actions} bleed largeTitle={false}>
        <div className="flex flex-col h-full min-h-0">
          <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto px-4">{body}</div>
          {composer && <div className="flex-none px-3 pb-3 pt-1">{composer}</div>}
        </div>
      </Page>
    </div>
  )
}

function Line({ item, onConfirm }: {
  item: Item
  onConfirm: (item: Extract<Item, { kind: 'confirm' }>, approved: boolean) => void
}) {
  const appear = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: spring.soft }
  switch (item.kind) {
    case 'user':
      return (
        <motion.div {...appear} className="self-end max-w-[85%] px-4 py-2.5 rounded-[20px] rounded-br-md bg-accent-fill text-white text-body whitespace-pre-wrap break-words">
          {item.text}
        </motion.div>
      )
    case 'assistant':
      return (
        <motion.div {...appear} className="self-start max-w-[85%] px-4 py-2.5 rounded-[20px] rounded-bl-md bg-surface text-label text-body whitespace-pre-wrap break-words">
          <RichText text={item.text} />
          {item.streaming && <span className="inline-block w-[2px] h-[1em] align-[-0.15em] ml-0.5 bg-label2 animate-pulse motion-reduce:animate-none" aria-hidden="true" />}
        </motion.div>
      )
    case 'tool': {
      const args = Object.entries(item.args).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')
      return (
        <motion.div {...appear} className="self-start inline-flex items-center gap-1.5 max-w-[85%] px-3 py-1 rounded-pill bg-fill text-caption text-label2">
          <Wrench size={12} strokeWidth={2} aria-hidden="true" className="flex-none" />
          <span className="truncate"><span className="font-medium">{item.name.replace(/^nexus_/, '').replace(/_/g, ' ')}</span>{args && ` · ${args}`}</span>
        </motion.div>
      )
    }
    case 'confirm': {
      const { name, detail } = describeAction(item.action)
      return (
        <motion.div {...appear} className="self-start w-full max-w-[85%] p-4 rounded-card bg-surface border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] flex flex-col gap-2" role="group" aria-label="Autorisation demandée">
          <p className="flex items-center gap-1.5 text-headline text-label"><ShieldCheck size={18} strokeWidth={1.75} className="text-accent" aria-hidden="true" />Jarvis veut {name}</p>
          {detail && <code className="font-mono text-caption text-label2 bg-fill rounded-control px-2.5 py-2 whitespace-pre-wrap break-all">{detail}</code>}
          {item.answer === undefined ? (
            <div className="flex gap-2 mt-1">
              <Button variant="primary" onClick={() => onConfirm(item, true)}>Autoriser</Button>
              <Button onClick={() => onConfirm(item, false)}>Refuser</Button>
            </div>
          ) : (
            <p className="text-subhead text-label2">{item.answer ? 'Autorisé' : 'Refusé'}</p>
          )}
        </motion.div>
      )
    }
    case 'notice':
      return (
        <p role={item.tone === 'error' ? 'alert' : 'status'}
          className={cn('self-center text-subhead text-center px-3', item.tone === 'error' ? 'text-danger-text' : 'text-label2')}>
          {item.text}
        </p>
      )
  }
}

function ApprovalCard({ approval, onDecide }: { approval: JarvisApproval; onDecide: (a: JarvisApproval, ok: boolean) => void }) {
  const { name, detail } = describeAction(approval.action)
  const [pending, setPending] = useState<boolean | null>(null)
  return (
    <div className="self-start w-full max-w-[85%] p-4 rounded-card bg-surface border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] flex flex-col gap-2" role="group" aria-label="Action en attente">
      <p className="flex items-center gap-1.5 text-headline text-label"><ShieldCheck size={18} strokeWidth={1.75} className="text-accent" aria-hidden="true" />Action en attente : {name}</p>
      <p className="text-subhead text-label2">Demandée{approval.source ? ` depuis « ${approval.source} »` : ''}</p>
      {detail && <code className="font-mono text-caption text-label2 bg-fill rounded-control px-2.5 py-2 whitespace-pre-wrap break-all">{detail}</code>}
      <div className="flex gap-2 mt-1">
        <Button variant="primary" loading={pending === true} disabled={pending !== null}
          onClick={() => { setPending(true); onDecide(approval, true) }}>Autoriser</Button>
        <Button loading={pending === false} disabled={pending !== null}
          onClick={() => { setPending(false); onDecide(approval, false) }}>Refuser</Button>
      </div>
    </div>
  )
}
