import express from 'express';
import { createClass, getClasses } from '../controllers/classController.js';
import { verifyToken, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', verifyToken, restrictTo('admin'), createClass);
router.get('/', verifyToken, getClasses);

export default router;
