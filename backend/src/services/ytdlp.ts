import { execFile } from 'child_process'
import { logger } from '../utils/logger'

/*
 * yt-dlp kept up to date by itself: YouTube changes its protections often, and an old
 * yt-dlp then fails with « HTTP Error 403: Forbidden » (the owner's 8-month-old one did).
 * scripts/deploy.sh updates it at every deployment; this does it once a day in between.
 * « [default,deno] » also brings yt-dlp-ejs and deno, the JavaScript runtime yt-dlp needs
 * for YouTube's checks (Node 20, on the server, is too old for it).
 */
const PYTHON = process.env.PYTHON_BIN || 'python3'
export const PIP_ARGS = ['-m', 'pip', 'install', '--user', '--upgrade', '--quiet', '--break-system-packages', 'yt-dlp[default,deno]']

export function updateYtDlp(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(PYTHON, PIP_ARGS, { timeout: 5 * 60_000 }, (err, _out, stderr) => {
      if (err) logger.warn(`yt-dlp update failed: ${(stderr || err.message).trim().split('\n').pop()}`)
      else logger.info('yt-dlp is up to date')
      resolve(!err)
    })
  })
}

let timer: NodeJS.Timeout | null = null
/** Daily, plus a first run 10 minutes after start. */
export function startYtDlpUpdater() {
  if (timer || process.env.YTDLP_AUTO_UPDATE === 'off' || process.env.NODE_ENV === 'test') return
  const run = () => { void updateYtDlp() }
  setTimeout(run, 10 * 60_000).unref()
  timer = setInterval(run, 24 * 60 * 60_000)
  timer.unref()
}
