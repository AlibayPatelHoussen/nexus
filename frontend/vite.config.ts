import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { createHash } from 'crypto'
import { execSync } from 'child_process'

/**
 * /app-files.json: the files of this build (not the source maps), for the service worker to keep
 * the app when mangas are kept offline (public/sw.js); `version` changes with them.
 */
function offlineAppFiles(): Plugin {
  return {
    name: 'nexus-offline-app-files',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => f.startsWith('assets/') && !f.endsWith('.map')).sort()
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 16)
      this.emitFile({ type: 'asset', fileName: 'app-files.json', source: JSON.stringify({ version, files }) })
    },
  }
}

// Commit the UI was built from (compared with the backend's at runtime)
function gitCommit(): string {
  try { return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() }
  catch { return process.env.NEXUS_COMMIT || 'dev' }
}

export default defineConfig({
  plugins: [react(), offlineAppFiles()],
  define: {
    __APP_COMMIT__: JSON.stringify(gitCommit()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
