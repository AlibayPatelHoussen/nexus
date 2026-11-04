import { Request, Response, NextFunction } from 'express'
import { AppError } from '../utils/errors'
import { logger } from '../utils/logger'
import { fsError } from '../utils/fsErrors'

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // File-system errors (EACCES, ENOENT…) become clear messages instead of a bare 500
  const fsErr = !(err instanceof AppError) ? fsError(err) : null
  if (fsErr) {
    logger.warn(`${(err as NodeJS.ErrnoException).code}: ${err.message}`)
    err = fsErr
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) logger.error(err.message, { stack: err.stack })

    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...((err as { details?: unknown }).details ? { details: (err as { details?: unknown }).details } : {}),
    })
    return
  }

  // Unexpected errors
  logger.error('Unexpected error', { stack: err.stack, message: err.message })

  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  })
}

export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError('Route not found', 404))
}
