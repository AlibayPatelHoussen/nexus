import { describe, expect, it } from 'vitest'
import { accessOf, canSee, homePath, isIptvHost } from './access'
import { NAV, tabsFor } from './nav'

const nexus = { host: 'nexus.exemple.com', hostname: 'nexus.exemple.com' }
const iptv = { host: 'iptv.exemple.com', hostname: 'iptv.exemple.com' }
const URL_ = 'https://iptv.exemple.com'

describe('isIptvHost', () => {
  it('knows the IPTV address set in the settings', () => {
    expect(isIptvHost('https://tele.exemple.com', { host: 'tele.exemple.com', hostname: 'tele.exemple.com' })).toBe(true)
    expect(isIptvHost('https://tele.exemple.com', nexus)).toBe(false)
  })
  it('takes any « iptv. » address for the IPTV, even before the settings are known', () => {
    expect(isIptvHost(null, iptv)).toBe(true)
    expect(isIptvHost(null, nexus)).toBe(false)
    expect(isIptvHost('pas une adresse', nexus)).toBe(false)
  })
})

describe('accessOf', () => {
  it('admins have everything at the Nexus address', () => {
    expect(accessOf({ role: 'admin', canMedia: false, canIptv: false }, URL_, nexus))
      .toMatchObject({ admin: true, media: true, iptv: true, iptvHost: false })
  })
  it('the IPTV address shows the IPTV only, even to admins', () => {
    const a = accessOf({ role: 'admin' }, URL_, iptv)
    expect(a).toMatchObject({ media: false, iptv: true, iptvHost: true })
    expect(homePath(a)).toBe('/iptv')
  })
  it('follows the account’s access', () => {
    expect(accessOf({ role: 'user', canMedia: true, canIptv: true }, URL_, nexus)).toMatchObject({ media: true, iptv: true })
    expect(accessOf({ role: 'user', canMedia: true, canIptv: false }, URL_, nexus)).toMatchObject({ media: true, iptv: false })
    const only = accessOf({ role: 'user', canMedia: false, canIptv: true }, URL_, nexus)
    expect(only).toMatchObject({ media: false, iptv: true })
    expect(homePath(only)).toBe('/iptv')
  })
  it('a session saved before the access existed keeps everything', () => {
    expect(accessOf({ role: 'user' }, null, nexus)).toMatchObject({ media: true, iptv: true })
  })
})

describe('what the navigation shows', () => {
  const paths = (a: ReturnType<typeof accessOf>) => NAV.filter((i) => canSee(i, a)).map((i) => i.to)

  it('an « IPTV seulement » account: the IPTV and the settings', () => {
    const a = accessOf({ role: 'user', canMedia: false, canIptv: true }, URL_, iptv)
    expect(paths(a).sort()).toEqual(['/iptv', '/settings'])
    expect(tabsFor(a).map((t) => t.to)).toContain('/iptv')
    expect(tabsFor(a).map((t) => t.to)).not.toContain('/cinema')
  })
  it('a « Médias » account: no IPTV, no server pages', () => {
    const a = accessOf({ role: 'user', canMedia: true, canIptv: false }, URL_, nexus)
    expect(paths(a)).toContain('/cinema')
    expect(paths(a)).not.toContain('/iptv')
    expect(paths(a)).not.toContain('/terminal')
  })
  it('an admin at the IPTV address: the IPTV and the settings only', () => {
    const a = accessOf({ role: 'admin' }, URL_, iptv)
    expect(paths(a).sort()).toEqual(['/iptv', '/settings'])
  })
})
