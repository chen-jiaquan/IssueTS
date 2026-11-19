import { Router } from 'express'
import auth from './auth.js'
import issues from './issues.js'
import stats from './stats.js'
import home from './home.js'
import archives from './archives.js'
import config from './config.js'
import upload from './upload.js'
import logs from './logs.js'
import notices from './notices.js'
import todos from './todos.js'

const router = Router()

router.get('/ping', (_req, res) => res.json({ code: 0, data: 'pong' }))

router.use('/auth', auth)
router.use('/archives', archives)
router.use('/config', config)
router.use('/upload', upload)
router.use('/logs', logs)
router.use('/notices', notices)
router.use('/todos', todos)
router.use('/issues', issues)
router.use('/stats', stats)
router.use('/home', home)

export default router
