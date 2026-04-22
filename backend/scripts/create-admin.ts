import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { db } from '../src/config/database'

async function createAdmin() {
  const username = process.argv[2] || 'admin'
  const password = process.argv[3] || 'admin123'
  const email    = process.argv[4] || 'admin@nexus.local'

  const hash = await bcrypt.hash(password, 10)

  await db.query(
    `INSERT INTO users (username, email, password, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (username) DO UPDATE SET password = $3`,
    [username, email, hash],
  )

  console.log(`✓ Admin créé : ${username} / ${password}`)
  await db.end()
}

createAdmin().catch((err) => { console.error(err); process.exit(1) })
