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

  // Uploads beyond the limits (multer): the limit, not a server error
  if (err.name === 'MulterError') {
    const code = (err as { code?: string }).code
    const tooBig = code === 'LIMIT_FILE_SIZE'
    res.status(tooBig || code === 'LIMIT_FILE_COUNT' ? 413 : 400).json({
      success: false,
      error: tooBig ? 'Fichier trop gros (5 Go au plus)' : code === 'LIMIT_FILE_COUNT' ? 'Trop de fichiers à la fois (500 au plus)' : 'Envoi refusé',
    })
    return
  }

  // A request the server cannot read (bad JSON, body too big…): its own 4xx, never details
  const status = (err as { status?: unknown }).status
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ success: false, error: status === 413 ? 'Requête trop grosse' : 'Requête invalide' })
    return
  }

  // Unexpected errors
  logger.error('Unexpected error', { stack: err.stack, message: err.message })

  res.status(500).json({
    success: false,
    // The details stay in the logs; only a developer's own machine shows them
    error: process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
      ? err.message
      : 'Internal server error',
  })
}

export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError('Route not found', 404))
}
