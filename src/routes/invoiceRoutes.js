import express from 'express';
import {
    createInvoice,
    getInvoices,
    createMidtransTransaction,
    handleMidtransWebhook,
    submitPaymentConfirmation,
    reviewPaymentConfirmation
} from '../controllers/invoiceController.js';
import { verifyToken, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/midtrans-webhook', handleMidtransWebhook);

router.get('/', verifyToken, restrictTo('murid', 'admin'), getInvoices);
router.post('/', verifyToken, restrictTo('admin'), createInvoice);
router.post('/:invoiceId/midtrans-token', verifyToken, restrictTo('murid', 'admin'), createMidtransTransaction);
router.post('/:invoiceId/pay', verifyToken, restrictTo('murid', 'admin'), submitPaymentConfirmation);
router.patch('/:invoiceId/verify', verifyToken, restrictTo('admin'), reviewPaymentConfirmation);

export default router;
