// PM2 Ecosystem Config — Nexus
const fs   = require('fs')
const path = require('path')

// Parse .env without dotenv dependency
const envVars = {}
try {
  const raw = fs.readFileSync(path.join(__dirname, 'backend/.env'), 'utf8')
  raw.split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
    if (m) envVars[m[1].trim()] = m[2].trim()
  })
} catch (e) {}

module.exports = {
  apps: [
    {
      name:        'nexus-backend',
      script:      './dist/index.js',
      cwd:         '/opt/nexus/backend',
      instances:   1,
      exec_mode:   'fork',
      watch:       false,
      max_memory_restart: '500M',

      env_production: {
        NODE_ENV: 'production',
        ...envVars,
      },

      out_file:    '/opt/nexus/logs/backend-out.log',
      error_file:  '/opt/nexus/logs/backend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:  true,

      autorestart:   true,
      restart_delay: 3000,
      max_restarts:  10,
      min_uptime:    '10s',
    },
  ],
}
