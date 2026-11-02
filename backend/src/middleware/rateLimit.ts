import rateLimit from 'express-rate-limit'

const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10) // 15 min

const handler: Parameters<typeof rateLimit>[0] = {
  windowMs,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
}

/** Brute-force protection for login / refresh. Successful logins are not counted. */
export const authLimiter = rateLimit({
  ...handler,
  limit: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10),
  skipSuccessfulRequests: true,
})

/**
 * General API limiter. Media streaming (video range requests, HLS segments,
 * manga pages) is excluded: a single session easily issues hundreds of requests.
 */
export const apiLimiter = rateLimit({
  ...handler,
  limit: parseInt(process.env.RATE_LIMIT_MAX || '1000', 10),
  // Playback (direct streaming, HLS playlists / segments, play info) is never limited
  skip: (req) => /^\/files\/(stream|transcode|play-info)(\/|$)/.test(req.path),
})
