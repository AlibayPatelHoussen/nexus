import { AuthService } from '../../src/services/auth'
import { UnauthorizedError, ConflictError } from '../../src/utils/errors'

// Mock the database
jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
}))

import { query } from '../../src/config/database'
const mockQuery = query as jest.MockedFunction<typeof query>

describe('AuthService', () => {

  beforeEach(() => jest.clearAllMocks())

  describe('generateAccessToken', () => {
    it('should generate a valid JWT', () => {
      process.env.JWT_SECRET = 'test_secret_for_unit_tests_minimum_length_ok'
      const token = AuthService.generateAccessToken({
        userId: 'uuid-123', username: 'houssen', role: 'admin',
      })
      expect(typeof token).toBe('string')
      expect(token.split('.')).toHaveLength(3)
    })
  })

  describe('login', () => {
    it('should throw UnauthorizedError when user not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] })
      await expect(AuthService.login('nobody', 'pass')).rejects.toThrow(UnauthorizedError)
    })

    it('should throw UnauthorizedError with wrong password', async () => {
      const bcrypt = await import('bcryptjs')
      const hashed = await bcrypt.hash('correctpass', 12)
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: '1', username: 'houssen', email: 'h@h.com', password: hashed, role: 'admin', theme: 'dark' }],
        rowCount: 1, command: '', oid: 0, fields: [],
      })
      await expect(AuthService.login('houssen', 'wrongpass')).rejects.toThrow(UnauthorizedError)
    })
  })

  describe('AppError classes', () => {
    it('UnauthorizedError has statusCode 401', () => {
      const err = new UnauthorizedError('test')
      expect(err.statusCode).toBe(401)
      expect(err.message).toBe('test')
    })

    it('ConflictError has statusCode 409', () => {
      const err = new ConflictError('duplicate')
      expect(err.statusCode).toBe(409)
    })
  })
})
