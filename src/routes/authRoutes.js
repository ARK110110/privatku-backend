import express from 'express';
import {
    login,
    register,
    getMe,
    getStudents,
    getTutors,
    getAllUsers,
    updateUserRole
} from '../controllers/authController.js';
import { verifyToken, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/login', login);
router.post('/register', register);
router.get('/me', verifyToken, getMe);
router.get('/students', verifyToken, restrictTo('admin', 'tentor'), getStudents);
router.get('/tutors', verifyToken, restrictTo('admin', 'tentor', 'murid'), getTutors);
router.get('/users', verifyToken, restrictTo('admin'), getAllUsers);
router.patch('/users/:userId/role', verifyToken, restrictTo('admin'), updateUserRole);

export default router;
