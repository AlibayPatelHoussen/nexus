import path from 'path'
import fs from 'fs'
import express from 'express'

// Call this AFTER all API routes, BEFORE error handler
// Serves the built React app for all non-API routes
export function serveStaticFrontend(app: express.Application): void {
  const frontendDist = path.resolve(__dirname, '../../frontend/dist')

  if (!fs.existsSync(frontendDist)) {
    return // Dev mode — Vite serves the frontend
  }

  // Serve static assets
  app.use(express.static(frontendDist))

  // SPA fallback — send index.html for all non-API routes
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
}