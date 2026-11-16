import { refreshDue } from '../../src/services/iptv'

const H = 3600_000
describe('when the IPTV catalogue is downloaded again (asked every hour)', () => {
  const ask = (o: { autoRefresh?: boolean; ageMs: number; empty?: boolean; changed?: boolean }) => {
    let asked = false
    return refreshDue({
      autoRefresh: o.autoRefresh ?? true, ageMs: o.ageMs, empty: o.empty ?? false,
      changed: async () => { asked = true; return !!o.changed },
    }).then((due) => ({ due, asked }))
  }

  it('within the hour after a source publishes a new version', async () => {
    expect(await ask({ ageMs: 3 * H, changed: true })).toEqual({ due: true, asked: true })
    expect(await ask({ ageMs: 3 * H, changed: false })).toEqual({ due: false, asked: true })
  })
  it('not again in the hour after a refresh; once a day at the latest, without asking', async () => {
    expect(await ask({ ageMs: 30 * 60_000, changed: true })).toEqual({ due: false, asked: false })
    expect(await ask({ ageMs: 25 * H })).toEqual({ due: true, asked: false })
  })
  it('switched off: only when the catalogue is empty', async () => {
    expect(await ask({ autoRefresh: false, ageMs: 30 * H, changed: true })).toEqual({ due: false, asked: false })
    expect(await ask({ autoRefresh: false, ageMs: 2 * H, empty: true })).toEqual({ due: true, asked: false })
  })
})
