import { api, getFreshAccessToken } from './api'

/**
 * Jarvis, the personal assistant (separate service on the server). The Nexus
 * backend relays every call (/api/jarvis/*) with the user's identity and role;
 * the Jarvis key never reaches the browser.
 */

export interface JarvisStatus {
  configured: boolean
  online:     boolean
  model?:     string
  /** Ollama stopped, model missing… */
  warning?:   string | null
}

export interface JarvisMessage {
  role:    'user' | 'assistant'
  content: string
}

export interface JarvisApproval {
  id:      number
  action:  string
  source:  string
  created: string
}

/** What Jarvis streams while it answers. */
export type JarvisEvent =
  | { type: 'token';   text: string }
  | { type: 'tool';    name: string; arguments: Record<string, unknown> }
  | { type: 'confirm'; id: string; action: string }
  | { type: 'done';    response: string }
  | { type: 'error';   message: string }

/**
 * Splits a Server-Sent Events buffer into events. Returns the parsed events and
 * the unfinished end of the buffer (to prepend to the next chunk).
 */
export function parseSSE(buffer: string): { events: JarvisEvent[]; rest: string } {
  const events: JarvisEvent[] = []
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n')
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    let kind = ''
    let data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) kind = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (!kind || !data) continue
    try {
      events.push({ type: kind, ...JSON.parse(data) } as JarvisEvent)
    } catch { /* ignore a malformed block */ }
  }
  return { events, rest }
}

/** Text to read aloud: no code blocks, markdown marks or links. */
export function speechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' (bloc de code) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/(\d)\s*[*×]\s*(?=\d)/g, '$1 fois ')                    // 6*7 → 6 fois 7
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[.,!?])/g, '$1$2')   // italique
    .replace(/https?:\/\/\S+/g, 'lien')
    .replace(/^\s*(#{1,6}|>|[-*])\s+/gm, '')                      // titres, citations, puces
    .replace(/\s+/g, ' ')
    .trim()
}

/** Sensitive Jarvis tools, as the user should read them. */
const ACTION_LABELS: Record<string, string> = {
  executer_commande:    'exécuter une commande',
  redemarrer_conteneur: 'redémarrer un conteneur',
  ecrire_fichier:       'écrire un fichier',
}

/** "executer_commande(commande='ls')" → readable action name + detail. */
export function describeAction(action: string): { name: string; detail: string } {
  const m = action.match(/^([a-z_]+)\((.*)\)$/s)
  if (!m) return { name: action, detail: '' }
  return { name: ACTION_LABELS[m[1]] ?? m[1].replace(/_/g, ' '), detail: m[2] }
}

export const jarvisService = {
  status: async (): Promise<JarvisStatus> =>
    (await api.get('/jarvis/status')).data.data,

  history: async (): Promise<JarvisMessage[]> =>
    (await api.get('/jarvis/history')).data.data,

  clear: async (): Promise<void> => { await api.post('/jarvis/clear') },

  approvals: async (): Promise<JarvisApproval[]> =>
    (await api.get('/jarvis/approvals')).data.data,

  decide: async (id: number, approved: boolean): Promise<{ approved: boolean; result: string }> =>
    (await api.post(`/jarvis/approvals/${id}`, { approved })).data.data,

  confirm: async (id: string, approved: boolean): Promise<void> => {
    await api.post('/jarvis/chat/confirm', { id, approved })
  },

  /**
   * Sends a message and calls onEvent for every streamed event.
   * fetch (not axios) so the answer can be read while it arrives.
   */
  async chat(message: string, onEvent: (e: JarvisEvent) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch('/api/jarvis/chat', {
      method:  'POST',
      headers: { Authorization: `Bearer ${await getFreshAccessToken()}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message }),
      signal,
    })
    if (!res.ok || !res.body) {
      let error = `Erreur ${res.status}`
      try { error = (await res.json()).error || error } catch { /* not JSON */ }
      throw new Error(error)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      const parsed = parseSSE(buffer + decoder.decode(value, { stream: true }))
      buffer = parsed.rest
      parsed.events.forEach(onEvent)
    }
    parseSSE(buffer + '\n\n').events.forEach(onEvent)
  },
}
