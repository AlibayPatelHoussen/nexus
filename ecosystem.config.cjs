// PM2 Ecosystem Config — Nexus
// Usage: pm2 start ecosystem.config.cjs

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
        NODE_ENV:     'production',
        PORT:         '3001',
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
