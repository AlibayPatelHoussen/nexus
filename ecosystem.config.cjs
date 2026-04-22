// PM2 Ecosystem Config — Nexus
// Usage: pm2 start ecosystem.config.cjs --env production

const path = require('path')

// Load .env so PM2 passes vars directly to the process
let envVars = {}
try {
  const dotenv = require('dotenv')
  const result = dotenv.config({ path: path.join(__dirname, 'backend/.env') })
  if (result.parsed) envVars = result.parsed
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

      // Logging
      out_file:    '/opt/nexus/logs/backend-out.log',
      error_file:  '/opt/nexus/logs/backend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:  true,

      // Auto-restart
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime:  '10s',
    },
  ],
}
