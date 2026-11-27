import 'dotenv/config'
import path from 'path'
import fs from 'fs'
import express from 'express'
import { createServer } from 'http'
import { Server as SocketServer } from 'socket.io'
import helmet from 'helmet'
import cors from 'cors'
import compression from 'compression'
import morgan from 'morgan'

import { logger }       from './utils/logger'
import { errorHandler } from './middleware/errorHandler'
import { notFound }     from './middleware/notFound'
import { apiLimiter }   from './middleware/rateLimit'
import authRoutes     from './routes/auth'
import systemRoutes   from './routes/system'
import deployRoutes   from './routes/deploy'
import filesRoutes    from './routes/files'
import mediaRoutes    from './routes/media'
import chaptersRoutes from './routes/chapters'
import servicesRoutes from './routes/services'
import downloadsRoutes from './routes/downloads'
import pushRoutes from './routes/push'
import './services/downloadNotifications'
import { startDownloadWorker } from './services/downloads'
import { startFollowChecker } from './services/follows'
import { startFilmsSiteChecker } from './services/filmsSite'
import { startCatalogueRefresher } from './services/catalogue'
import { startImdbSync } from './services/imdb'
import { startYtDlpUpdater } from './services/ytdlp'
import { startKeyframeIndexer } from './services/keyframeIndexer'
import { startJarvisNotifier } from './services/jarvis'
import terminalRoutes from './routes/terminal'
import imagesRoutes   from './routes/images'
import castRoutes     from './routes/cast'
import iptvRoutes     from './routes/iptv'
import jarvisRoutes   from './routes/jarvis'
import usersRoutes    from './routes/users'
import transfersRoutes from './routes/transfers'
import renameRoutes from './routes/rename'
import { startTransfersWorker } from './services/transfers'
import { iptvPublicUrl, startIptvWorker } from './services/iptv'
import { registerSocketHandlers } from './socket'

const STARTED_AT = new Date().toISOString()
const BUILD_INFO: { commit: string; builtAt: string | null } = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8'))
  } catch {
    return { commit: 'dev', builtAt: null }
  }
})()

const app    = express()
// Only the Cloudflare tunnel (cloudflared, on this machine) may say who the visitor is:
// a device on the local network cannot fake its address (rate limits, journal) with X-Forwarded-For
app.set('trust proxy', 'loopback')
const server = createServer(app)
const io     = new SocketServer(server, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true },
})

const PORT = parseInt(process.env.PORT || '3001', 10)

// HTTPS everywhere: a visitor who reached Cloudflare over http is sent to https (the local
// network keeps http, for TVs and casting). Browsers then stay on https (HSTS below).
app.use((req, res, next) => {
  if (req.get('x-forwarded-proto') === 'http' && req.get('cf-ray')
    && req.socket.remoteAddress && /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress)
    && (req.method === 'GET' || req.method === 'HEAD') && req.get('host')) {
    res.redirect(308, `https://${req.get('host')}${req.originalUrl}`)
    return
  }
  next()
})

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // Ignored by browsers over the local network's http; one year over https
  strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: false },
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", 'https://static.cloudflareinsights.com'],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc:      ["'self'", 'data:', 'blob:', 'https://image.tmdb.org', 'https://img.anilist.co', 'https://uploads.mangadex.org'],
      connectSrc:  ["'self'", 'wss:', 'ws:'],
      mediaSrc:    ["'self'", 'blob:'],
      fontSrc:     ["'self'", 'data:', 'https://fonts.gstatic.com'],
    },
  },
}))
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }))
app.use(compression())
// GitHub webhook: needs the raw body (signature), so before express.json
app.use('/api/deploy', apiLimiter, deployRoutes)
// Request bodies: 1 MB, except the file editor and an M3U list for « Mes chaînes » (10 MB each)
const jsonSmall = express.json({ limit: '1mb' })
const jsonLarge = express.json({ limit: '11mb' })
const LARGE_BODIES = new Set(['/api/files/write', '/api/iptv/my-channels/import'])
app.use((req, res, next) => (LARGE_BODIES.has(req.path) ? jsonLarge : jsonSmall)(req, res, next))
app.use(express.urlencoded({ extended: true, limit: '100kb' }))
// Never write tokens passed in query strings (media URLs) to the logs
morgan.token('safe-url', (req) =>
  ((req as express.Request).originalUrl || req.url || '').replace(/([?&]token=)[^&]*/gi, '$1[REDACTED]'))
app.use(morgan(
  ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"',
  { stream: { write: (msg) => logger.info(msg.trim()) } },
))

app.use('/api', apiLimiter)


app.use('/api/images',   imagesRoutes)
app.use('/api/auth',     authRoutes)
app.use('/api/system',   systemRoutes)
app.use('/api/files',    filesRoutes)
// Chapters first: its page route takes the stream token in the query string
app.use('/api/media',    chaptersRoutes)
app.use('/api/media',    mediaRoutes)
app.use('/api/services', servicesRoutes)
app.use('/api/downloads', downloadsRoutes)
app.use('/api/push', pushRoutes)
app.use('/api/cast', castRoutes)
app.use('/api/iptv', iptvRoutes)
app.use('/api/jarvis', jarvisRoutes)
app.use('/api/users', usersRoutes)
app.use('/api/transfers', transfersRoutes)
app.use('/api/library/rename', renameRoutes)
app.use('/api/terminal', terminalRoutes)
app.get('/api/health', (_req, res) => {
  void iptvPublicUrl().catch(() => null).then((iptvUrl) => res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    // Lets the UI detect a backend that was not rebuilt / restarted after a deploy
    build:     BUILD_INFO,
    startedAt: STARTED_AT,
    // The IPTV's own subdomain: Nexus opened there shows the IPTV only
    iptvUrl:   iptvUrl ?? null,
  }))
})

// Unknown API routes are real 404s (never the SPA's index.html)
app.use('/api', notFound)

registerSocketHandlers(io)

// Serve frontend — __dirname is dist/ in production
const frontendDist = path.resolve(__dirname, '../../frontend/dist')
if (fs.existsSync(frontendDist)) {
  // index.html must always be revalidated so a deploy is picked up immediately;
  // Vite's hashed assets (/assets/*-<hash>.js|css) never change and can be cached for a year.
  const noCache = (res: express.Response) => res.setHeader('Cache-Control', 'no-cache')
  app.use(express.static(frontendDist, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      } else {
        noCache(res)
      }
    },
  }))
  app.use((_req, res) => {
    noCache(res)
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
}

app.use(notFound)
app.use(errorHandler)

if (require.main === module) {
  // Sessions are signed with JWT_SECRET: never start with none (or a guessable one)
  const jwtSecret = process.env.JWT_SECRET ?? ''
  if (!jwtSecret) {
    logger.error('JWT_SECRET is missing in backend/.env: Nexus will not start without it (create one with "openssl rand -hex 32").')
    process.exit(1)
  }
  // The placeholders of .env.example are public: anyone could sign a session with them
  if (/^(your_super_secret|another_different_secret)/.test(jwtSecret) || /^(your_super_secret|another_different_secret)/.test(process.env.JWT_REFRESH_SECRET ?? '')) {
    logger.error('JWT_SECRET / JWT_REFRESH_SECRET still hold the example of .env.example: replace them with "openssl rand -hex 32" (Nexus will not start until then).')
    process.exit(1)
  }
  if (jwtSecret.length < 32) logger.warn('JWT_SECRET is short (under 32 characters): replace it with "openssl rand -hex 32" (every device will sign in again).')

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      // Typical after a deploy when an old Nexus process (started by hand, systemd
      // or another user) still holds the port: it would keep serving the old code
      logger.error(
        `Port ${PORT} is already in use — another process (probably an old Nexus backend) is running. ` +
        `Stop it (e.g. "sudo fuser -k ${PORT}/tcp") then "pm2 restart nexus-backend".`,
      )
      process.exit(1)
    }
    throw err
  })
  server.listen(PORT, () => {
    logger.info(`Nexus backend ${BUILD_INFO.commit} running on port ${PORT} [${process.env.NODE_ENV}]`)
    startDownloadWorker().catch((err: Error) => logger.error(`Download worker: ${err.message}`))
    startFollowChecker()
    startFilmsSiteChecker()
    startIptvWorker()
    startCatalogueRefresher()
    startImdbSync()
    startYtDlpUpdater()
    startKeyframeIndexer()
    startJarvisNotifier()
    startTransfersWorker()
  })
}

export { app, io }
