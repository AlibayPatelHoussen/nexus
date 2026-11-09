import { Router } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate, requireAdmin } from '../middleware/auth'
import { authLimiter } from '../middleware/rateLimit'
import * as controller from '../controllers/auth'

const router = Router()

router.post('/login',    authLimiter, controller.loginValidators, asyncHandler(controller.login))
router.post('/logout',   asyncHandler(controller.logout))
router.post('/refresh',  authLimiter, asyncHandler(controller.refresh))
router.post('/register', authenticate, requireAdmin, controller.registerValidators, asyncHandler(controller.register))
router.get('/me',        authenticate, asyncHandler(controller.me))
router.get('/stream-token', authenticate, controller.streamToken)
router.patch('/password', authenticate, controller.changePasswordValidators, asyncHandler(controller.changePassword))
router.patch('/username', authLimiter, authenticate, controller.changeUsernameValidators, asyncHandler(controller.changeUsername))
router.patch('/theme',    authenticate, asyncHandler(controller.updateTheme))

export default router
