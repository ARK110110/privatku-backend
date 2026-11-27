import express from 'express';
import {
    enrollSchedule,
    unenrollSchedule,
    getAvailableSchedules
} from '../controllers/enrollmentController.js';
import { verifyToken, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/catalog', verifyToken, restrictTo('murid'), getAvailableSchedules);
router.post('/', verifyToken, restrictTo('murid'), enrollSchedule);
router.delete('/:scheduleId', verifyToken, restrictTo('murid'), unenrollSchedule);

export default router;
