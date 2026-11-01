import os from 'os'
import path from 'path'
import fs from 'fs'

// Defaults for tests (CI may override JWT_SECRET)
process.env.JWT_SECRET ||= 'test_secret_for_jest_only_not_production'
process.env.MEDIA_ROOT   = path.join(os.tmpdir(), 'nexus-test-media')
process.env.SCRIPTS_PATH = path.join(os.tmpdir(), 'nexus-test-scripts')
fs.mkdirSync(process.env.MEDIA_ROOT, { recursive: true })
fs.mkdirSync(process.env.SCRIPTS_PATH, { recursive: true })
