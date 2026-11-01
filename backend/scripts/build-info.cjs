// Writes dist/build-info.json (git commit + build date) after `tsc`, so the
// running backend can report exactly which code it is running.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

let commit = process.env.NEXUS_COMMIT || 'unknown'
try {
  commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim()
} catch { /* not a git checkout */ }

const out = path.join(__dirname, '..', 'dist', 'build-info.json')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify({ commit, builtAt: new Date().toISOString() }, null, 2))
console.log(`build-info: ${commit}`)
