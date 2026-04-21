import { Router } from 'express'
import { authenticate } from '../middleware/auth'

// Terminal is handled via Socket.io /terminal namespace
// This route just confirms the feature is available
const router = Router()
router.use(authenticate)
router.get('/', (_req, res) => res.json({ success: true, message: 'Use Socket.io /terminal namespace' }))

export default router
