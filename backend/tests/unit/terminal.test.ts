import { loginEnv } from '../../src/services/terminal'

describe('terminal login environment', () => {
  it('is a clean login environment, without Nexus secrets', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret-for-test'
    const env = loginEnv()
    expect(env.TERM).toBe('xterm-256color')
    expect(env.HOME).toBeTruthy()
    expect(env.USER).toBeTruthy()
    expect(env.PATH).toContain('/usr/bin')
    expect(Object.keys(env)).not.toEqual(expect.arrayContaining(['JWT_SECRET']))
    expect(env.JWT_SECRET).toBeUndefined()
    expect(env.DB_PASSWORD).toBeUndefined()
    expect(env.NODE_ENV).toBeUndefined()
  })
})
