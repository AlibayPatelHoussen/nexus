jest.mock('../../src/config/database', () => ({ query: jest.fn() }))
jest.mock('../../src/services/push', () => ({ sendPush: jest.fn().mockResolvedValue(1) }))

import { query } from '../../src/config/database'
import { sendPush } from '../../src/services/push'
import { relayJarvisNotifications } from '../../src/services/jarvis'

const mockedQuery = query as jest.Mock
const mockedPush = sendPush as jest.Mock

describe('Jarvis reminders → Nexus web push', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
    jest.clearAllMocks()
  })

  it('does nothing when Jarvis is not configured', async () => {
    delete process.env.JARVIS_API_KEY
    expect(await relayJarvisNotifications()).toBe(0)
    expect(mockedQuery).not.toHaveBeenCalled()
  })

  it('pushes each user’s notifications to their own devices', async () => {
    process.env.JARVIS_API_KEY = 'jv_test'
    process.env.JARVIS_URL = 'http://jarvis.test'
    process.env.JARVIS_OWNER = 'houssen'
    mockedQuery.mockResolvedValue({ rows: [
      { id: 'uuid-houssen', username: 'Houssen', role: 'admin' },
      { id: 'uuid-alice', username: 'alice', role: 'user' },
    ] })
    const calls: { user: string | null }[] = []
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const user = new Headers(init?.headers).get('X-Jarvis-User')
      calls.push({ user })
      const notifications = user === 'owner'
        ? [{ id: 1, kind: 'reminder', message: 'Appeler maman' },
           { id: 2, kind: 'info', message: 'Autorisation demandée (#4) : executer_commande(...)' }]
        : []
      return new Response(JSON.stringify({ notifications }), { status: 200 })
    }) as typeof fetch

    expect(await relayJarvisNotifications()).toBe(2)
    expect(calls.map((c) => c.user)).toEqual(['owner', 'uuid-alice'])
    expect(mockedPush).toHaveBeenCalledWith(['uuid-houssen'],
      { title: 'Rappel de Jarvis', body: 'Appeler maman', url: '/jarvis', tag: 'jarvis-1' })
    expect(mockedPush.mock.calls[1][1].title).toBe('Jarvis demande une autorisation')
  })
})
