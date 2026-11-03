import fs from 'fs'
import os from 'os'
import path from 'path'
import { parseShow, serviceState, ServicesService, type UnitState } from '../../src/services/services'

const unit = (Id: string, ActiveState: string, extra: Partial<UnitState> = {}): UnitState => ({
  Id, LoadState: 'loaded', ActiveState, SubState: '', UnitFileState: 'enabled', Description: Id,
  StateChangeTimestamp: 'Mon 2026-11-02 10:00:00 UTC', MemoryCurrent: '[not set]', Type: 'simple', ...extra,
})
const missing = (Id: string): UnitState => ({ ...unit(Id, 'inactive'), LoadState: 'not-found' })

describe('service state from systemd', () => {
  it('Cockpit idle (socket listening, service stopped) is "on demand", not stopped', () => {
    const s = serviceState({ units: ['cockpit.service', 'cockpit.socket'] }, [unit('cockpit.service', 'inactive'), unit('cockpit.socket', 'active')])
    expect(s.status).toBe('waiting')
  })

  it('Cockpit in use is active; socket and service both stopped is stopped', () => {
    expect(serviceState({ units: ['cockpit.service', 'cockpit.socket'] }, [unit('cockpit.service', 'active'), unit('cockpit.socket', 'active')]).status).toBe('active')
    expect(serviceState({ units: ['cockpit.service', 'cockpit.socket'] }, [unit('cockpit.service', 'inactive'), unit('cockpit.socket', 'inactive')]).status).toBe('inactive')
  })

  it('a unit that does not exist is "not installed", not "stopped"', () => {
    const s = serviceState({ units: ['filebrowser.service'] }, [missing('filebrowser.service')])
    expect(s.status).toBe('missing')
  })

  it('Wi-Fi: the first installed manager is used', () => {
    const s = serviceState({ units: ['wifi.service', 'NetworkManager.service', 'wpa_supplicant.service'], anyOf: true },
      [missing('wifi.service'), unit('NetworkManager.service', 'active'), unit('wpa_supplicant.service', 'failed')])
    expect(s.status).toBe('active')
    expect(s.units).toEqual(['NetworkManager.service'])
  })

  it('an armed timer is active; a failed run shows as failed', () => {
    expect(serviceState({ units: ['w.timer', 'w.service'] }, [unit('w.timer', 'active'), unit('w.service', 'inactive', { Type: 'oneshot' })]).status).toBe('active')
    expect(serviceState({ units: ['w.timer', 'w.service'] }, [unit('w.timer', 'active'), unit('w.service', 'failed', { Type: 'oneshot' })]).status).toBe('failed')
  })

  it('reports since when and memory of a running service', () => {
    const s = serviceState({ units: ['jellyfin.service'] }, [unit('jellyfin.service', 'active', { MemoryCurrent: '262144000' })])
    expect(s.since).toBe('2026-11-02T10:00:00.000Z')
    expect(s.memory).toBe(262144000)
    expect(s.enabled).toBe(true)
  })

  it('parses systemctl show output', () => {
    const out = 'Id=a.service\nLoadState=loaded\nActiveState=active\n\nId=b.socket\nLoadState=not-found\nActiveState=inactive\n'
    expect(parseShow(out).map((u) => [u.Id, u.LoadState])).toEqual([['a.service', 'loaded'], ['b.socket', 'not-found']])
  })
})

describe('ServicesService with the real systemctl command', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-systemctl-'))
  const oldPath = process.env.PATH
  beforeAll(() => {
    // Fake systemctl: Cockpit idle on its socket, Jellyfin running, everything else not installed
    fs.writeFileSync(path.join(bin, 'systemctl'), `#!/bin/sh
for u in "$@"; do
  case "$u" in --*|show) continue;; esac
  case "$u" in
    cockpit.socket|jellyfin.service) printf 'Id=%s\\nLoadState=loaded\\nActiveState=active\\nUnitFileState=enabled\\nDescription=%s\\n\\n' "$u" "$u";;
    cockpit.service) printf 'Id=%s\\nLoadState=loaded\\nActiveState=inactive\\nUnitFileState=static\\nDescription=Cockpit Web Service\\n\\n' "$u";;
    *) printf 'Id=%s\\nLoadState=not-found\\nActiveState=inactive\\n\\n' "$u";;
  esac
done
`, { mode: 0o755 })
    process.env.PATH = `${bin}:${oldPath}`
  })
  afterAll(() => { process.env.PATH = oldPath })

  it('shows Cockpit as on demand, Jellyfin active and missing services as not installed', async () => {
    const all = await ServicesService.getAll()
    const by = Object.fromEntries(all.map((s) => [s.name, s.status]))
    expect(by.cockpit).toBe('waiting')
    expect(by.jellyfin).toBe('active')
    expect(by.filebrowser).toBe('missing')
    expect(by.wifi).toBe('missing')
  })
})
