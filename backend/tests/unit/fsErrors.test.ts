import { fsError } from '../../src/utils/fsErrors'

const err = (code: string) => Object.assign(new Error(code), { code })

describe('fsError', () => {
  it.each([
    ['EACCES', 403, /Permission refusée.*chown/],
    ['EPERM', 403, /Permission refusée/],
    ['ENOENT', 404, /n'existe plus/],
    ['EBUSY', 409, /en cours d'utilisation/],
    ['ENOTEMPTY', 409, /pas vide/],
    ['EROFS', 409, /lecture seule/],
  ])('%s → %d', (code, status, msg) => {
    const e = fsError(err(code), '/media/films/a b.mkv')!
    expect(e.statusCode).toBe(status)
    expect(e.message).toMatch(msg)
    expect(e.message).toContain('a b.mkv')
  })
  it('ignores non file-system errors', () => {
    expect(fsError(new Error('x'))).toBeNull()
  })
})

describe('sanitizePath with FILES_ROOT', () => {
  it('confines paths and blocks ../ escapes', () => {
    jest.isolateModules(() => {
      process.env.FILES_ROOT = '/srv/data'
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { sanitizePath } = require('../../src/services/files')
      expect(sanitizePath('/srv/data/films/a.mkv')).toBe('/srv/data/films/a.mkv')
      expect(() => sanitizePath('/srv/data/../../etc/passwd')).toThrow(/en dehors/)
      expect(() => sanitizePath('/etc')).toThrow(/en dehors/)
      delete process.env.FILES_ROOT
    })
  })
})
