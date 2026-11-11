import { describe, expect, it } from 'vitest'
import { describeAction, parseSSE, speechText } from './jarvisService'

describe('parseSSE', () => {
  it('parses complete events and keeps the unfinished end', () => {
    const { events, rest } = parseSSE(
      'event: tool\ndata: {"name": "calculer", "arguments": {"expression": "6*7"}}\n\n'
      + 'event: token\ndata: {"text": "6*7 = "}\n\n'
      + 'event: tok',
    )
    expect(events).toEqual([
      { type: 'tool', name: 'calculer', arguments: { expression: '6*7' } },
      { type: 'token', text: '6*7 = ' },
    ])
    expect(rest).toBe('event: tok')
  })

  it('joins chunks cut anywhere', () => {
    const stream = 'event: token\ndata: {"text": "Bonjour"}\n\nevent: done\ndata: {"response": "Bonjour"}\n\n'
    for (let cut = 1; cut < stream.length; cut++) {
      const first = parseSSE(stream.slice(0, cut))
      const second = parseSSE(first.rest + stream.slice(cut))
      expect([...first.events, ...second.events]).toEqual([
        { type: 'token', text: 'Bonjour' },
        { type: 'done', response: 'Bonjour' },
      ])
    }
  })

  it('handles CRLF, confirm events and malformed blocks', () => {
    const { events } = parseSSE(
      'event: confirm\r\ndata: {"id": "ab12", "action": "executer_commande(commande=\'ls\')"}\r\n\r\n'
      + 'event: token\ndata: {pas du json}\n\n'
      + 'data: {"text": "sans type"}\n\n',
    )
    expect(events).toEqual([{ type: 'confirm', id: 'ab12', action: "executer_commande(commande='ls')" }])
  })
})

describe('speechText', () => {
  it('removes markdown, code and links before reading aloud', () => {
    expect(speechText('Le serveur va **bien** : voir `uptime` ou https://exemple.com/x\n```bash\nls\n```'))
      .toBe('Le serveur va bien : voir uptime ou lien (bloc de code)')
  })

  it('keeps maths and reads lists and titles without symbols', () => {
    expect(speechText('6*7 = 42')).toBe('6 fois 7 = 42')
    expect(speechText('# Bilan\n- disque : *ok*\n> note')).toBe('Bilan disque : ok note')
  })
})

describe('describeAction', () => {
  it('splits the tool name and its arguments', () => {
    expect(describeAction("redemarrer_conteneur(nom='jellyfin')"))
      .toEqual({ name: 'redémarrer un conteneur', detail: "nom='jellyfin'" })
    expect(describeAction("autre_outil(x=1)")).toEqual({ name: 'autre outil', detail: 'x=1' })
    expect(describeAction('texte libre')).toEqual({ name: 'texte libre', detail: '' })
  })
})
