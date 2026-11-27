import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/authRoutes.js';
import classRoutes from './routes/classRoutes.js';
import scheduleRoutes from './routes/scheduleRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import enrollmentRoutes from './routes/enrollmentRoutes.js';

dotenv.config();

const app = express();

// Middleware (limit ditingkatkan untuk mendukung payload gambar base64 ke Cloudinary)
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Endpoint Routes
app.use('/api/auth', authRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/attendances', attendanceRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/enrollments', enrollmentRoutes);

// Root Route
app.get('/', (req, res) => {
    res.json({ message: 'Api Aktif!' });
});

// Menjalankan Server saat lokal; Vercel Serverless menggunakan export default app
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`Server berjalan di port ${PORT}`);
    });
}

export default app;
