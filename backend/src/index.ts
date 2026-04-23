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
import authRoutes     from './routes/auth'
import systemRoutes   from './routes/system'
import filesRoutes    from './routes/files'
import mediaRoutes    from './routes/media'
import chaptersRoutes from './routes/chapters'
import servicesRoutes from './routes/services'
import scriptsRoutes  from './routes/scripts'
import terminalRoutes from './routes/terminal'
import { registerSocketHandlers } from './socket'

const app    = express()
app.set('trust proxy', 1)
const server = createServer(app)
const io     = new SocketServer(server, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true },
})

const PORT = parseInt(process.env.PORT || '3001', 10)

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],
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
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }))


app.use('/api/auth',     authRoutes)
app.use('/api/system',   systemRoutes)
app.use('/api/files',    filesRoutes)
app.use('/api/media',    mediaRoutes)
app.use('/api/media',    chaptersRoutes)
app.use('/api/services', servicesRoutes)
app.use('/api/scripts',  scriptsRoutes)
app.use('/api/terminal', terminalRoutes)
app.get('/api/health',   (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

registerSocketHandlers(io)

// Serve frontend — __dirname is dist/ in production
const frontendDist = path.resolve(__dirname, '../../frontend/dist')
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist))
  app.use((_req, res) => res.sendFile(path.join(frontendDist, 'index.html')))
}

app.use(notFound)
app.use(errorHandler)

if (require.main === module) {
  server.listen(PORT, () => logger.info(`Nexus backend running on port ${PORT} [${process.env.NODE_ENV}]`))
}

export { app, io }
