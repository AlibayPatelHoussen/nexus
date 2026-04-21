import { Request, Response, NextFunction } from 'express'
import { AppError } from '../utils/errors'

export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError('Route not found', 404))
}
