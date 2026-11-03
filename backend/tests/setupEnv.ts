import os from 'os'
import path from 'path'
import fs from 'fs'

// Defaults for tests (CI may override JWT_SECRET)
process.env.JWT_SECRET ||= 'test_secret_for_jest_only_not_production'
process.env.MEDIA_ROOT   = path.join(os.tmpdir(), 'nexus-test-media')
process.env.TRANSCODE_IDLE_MS = '1500'
process.env.TRANSCODE_DIR = path.join(os.tmpdir(), 'nexus-test-hls')
fs.mkdirSync(process.env.MEDIA_ROOT, { recursive: true })
