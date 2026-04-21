import { AppError, NotFoundError, ValidationError, ForbiddenError } from '../../src/utils/errors'

describe('Error utilities', () => {
  describe('AppError', () => {
    it('should set message and statusCode', () => {
      const err = new AppError('Something went wrong', 500)
      expect(err.message).toBe('Something went wrong')
      expect(err.statusCode).toBe(500)
      expect(err.isOperational).toBe(true)
    })

    it('should be an instance of Error', () => {
      const err = new AppError('test', 400)
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(AppError)
    })
  })

  describe('NotFoundError', () => {
    it('should have 404 status', () => {
      const err = new NotFoundError('User')
      expect(err.statusCode).toBe(404)
      expect(err.message).toContain('User')
    })
  })

  describe('ValidationError', () => {
    it('should have 422 status', () => {
      const err = new ValidationError('Invalid input')
      expect(err.statusCode).toBe(422)
    })
  })

  describe('ForbiddenError', () => {
    it('should have 403 status', () => {
      const err = new ForbiddenError()
      expect(err.statusCode).toBe(403)
    })
  })
})
