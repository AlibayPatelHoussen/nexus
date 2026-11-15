import path from 'path'
import { FIXTURES } from './helpers'

// Integration tests: the accounts behind makeToken() exist (role, session version 1, no expiry)
beforeAll(async () => {
  if (!expect.getState().testPath?.includes(`${path.sep}integration${path.sep}`)) return
  const { query } = await import('../src/config/database')
  for (const [role, f] of [['admin', FIXTURES.admin], ['user', FIXTURES.user], ['user', FIXTURES.other]] as const) {
    await query(
      `INSERT INTO users (id, username, email, password, role) VALUES ($1, $2, $3, 'x', $4)
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, session_version = 1, expires_at = NULL`,
      [f.id, f.username, `${f.username}@fixtures.test`, role],
    )
  }
})
