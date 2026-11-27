import express from 'express';
import {
    getAttendances,
    createAttendance,
    openAttendanceSession,
    closeAttendanceSession,
    getActiveSessionStatus
} from '../controllers/attendanceController.js';
import { verifyToken, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', verifyToken, getAttendances);
router.post('/', verifyToken, createAttendance);
router.post('/session/open', verifyToken, restrictTo('tentor', 'admin'), openAttendanceSession);
router.post('/session/close', verifyToken, restrictTo('tentor', 'admin'), closeAttendanceSession);
router.get('/session/status/:scheduleId', verifyToken, getActiveSessionStatus);

export default router;
