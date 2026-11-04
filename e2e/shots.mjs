/**
 * Design screenshots of Nexus, desktop (1440 × 900) and iPhone (390 × 844),
 * dark and light: the check after every visual change (CLAUDE.md).
 *
 *   node e2e/shots.mjs                      every page
 *   node e2e/shots.mjs cinema settings      only these pages
 *   node e2e/shots.mjs serie=/media/<id>    any page
 *   THEMES=dark node e2e/shots.mjs cinema   one theme
 *
 * Needs the E2E environment (bash e2e/setup.sh); after a frontend change,
 * `npm run build -w frontend` is enough (the backend serves frontend/dist).
 * Images go to $E2E_DIR/shots/design/<page>-<width>-<theme>.png
 */
import fs from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { chromium, devices } = require('playwright')

const E2E = process.env.E2E_DIR || '/tmp/nexus-e2e'
const cfg = JSON.parse(fs.readFileSync(`${E2E}/config.json`, 'utf8'))
const OUT = `${E2E}/shots/design`
fs.mkdirSync(OUT, { recursive: true })

const PAGES = {
  dashboard: '/dashboard', cinema: '/cinema', animes: '/animes', manga: '/manga', youtube: '/youtube',
  downloads: '/downloads', files: '/files', terminal: '/terminal', services: '/services', network: '/network',
  settings: '/settings', login: '/login',
}
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'))
// "name=/path" captures any page (e.g. serie=/media/<id>)
const extra = wanted.filter((a) => a.includes('=')).map((a) => a.split(/=(.*)/s).slice(0, 2))
const pages = [...Object.entries(PAGES).filter(([k]) => !wanted.length || wanted.includes(k)), ...extra]
const themes = (process.env.THEMES || 'dark,light').split(',')
const VIEWPORTS = [
  { name: '1440', options: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  { name: '390', options: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
]

const res = await fetch(`${cfg.base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Admin1234' }),
})
const session = (await res.json()).data

const browser = await chromium.launch()
for (const vp of VIEWPORTS) {
  for (const theme of themes) {
    const ctx = await browser.newContext({ ...vp.options, colorScheme: theme })
    await ctx.addInitScript(([rt, u, t]) => {
      localStorage.setItem('nexus_refresh_token', rt)
      localStorage.setItem('nexus-auth', JSON.stringify({ state: { user: u, theme: t, isAuth: true }, version: 0 }))
    }, [session.refreshToken, session.user, theme])
    for (const [name, path] of pages) {
      const page = await ctx.newPage()
      if (name === 'login') await ctx.clearCookies()
      await page.goto(cfg.base + path, { waitUntil: 'networkidle' }).catch(() => {})
      await page.waitForTimeout(900)             // entrance animations
      const file = `${OUT}/${name}-${vp.name}-${theme}.png`
      await page.screenshot({ path: file })
      console.log(file)
      if (process.env.SCROLL) {   // a second image further down (rows, lists)
        await page.evaluate((y) => { const m = document.getElementById('main'); if (m && m.scrollHeight > m.clientHeight) m.scrollTo(0, y); else window.scrollTo(0, y) }, Number(process.env.SCROLL))
        await page.waitForTimeout(500)
        await page.screenshot({ path: file.replace('.png', '-scroll.png') })
      }
      await page.close()
    }
    await ctx.close()
  }
}
await browser.close()
