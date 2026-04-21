import { Router } from 'express'
import asyncHandler from 'express-async-handler'
import { authenticate, requireAdmin } from '../middleware/auth'
import * as controller from '../controllers/auth'

const router = Router()

router.post('/login',    controller.loginValidators,    asyncHandler(controller.login))
router.post('/logout',   asyncHandler(controller.logout))
router.post('/refresh',  asyncHandler(controller.refresh))
router.post('/register', authenticate, requireAdmin, controller.registerValidators, asyncHandler(controller.register))
router.get('/me',        authenticate, asyncHandler(controller.me))
router.patch('/password', authenticate, asyncHandler(controller.changePassword))
router.patch('/theme',    authenticate, asyncHandler(controller.updateTheme))

export default router
