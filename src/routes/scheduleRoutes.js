import express from 'express';
import { createSchedule, getSchedules } from '../controllers/scheduleController.js';
import { verifyToken, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', verifyToken, getSchedules);
router.post('/', verifyToken, restrictTo('admin'), createSchedule);

export default router;
