import midtransClient from 'midtrans-client';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = String(process.env.MIDTRANS_IS_PRODUCTION).toLowerCase() === 'true';

const snap = new midtransClient.Snap({
    isProduction,
    serverKey: process.env.MIDTRANS_SERVER_KEY || '',
    clientKey: process.env.MIDTRANS_CLIENT_KEY || ''
});

export { snap, isProduction };
