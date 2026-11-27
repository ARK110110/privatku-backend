import crypto from 'crypto';
import db from '../config/db.js';
import cloudinary from '../config/cloudinary.js';
import { snap } from '../config/midtrans.js';

function extractInvoiceIdFromOrderId(orderId) {
    const match = String(orderId || '').match(/^PRIVATKU-INV-(\d+)-/);
    return match ? Number(match[1]) : null;
}

export async function createInvoice(req, res) {
    const { student_id, amount, due_date, payment_gateway_url } = req.body;
    try {
        if (!student_id || !amount || !due_date) {
            return res.status(400).json({ message: 'student_id, amount, dan due_date wajib diisi.' });
        }

        const [result] = await db.execute(
            `INSERT INTO invoices (student_id, amount, due_date, status, payment_gateway_url) 
             VALUES (?, ?, ?, 'belum_bayar', ?)`,
            [student_id, amount, due_date, payment_gateway_url || null]
        );
        res.status(201).json({ message: 'Tagihan SPP berhasil diterbitkan.', invoice_id: result.insertId });
    } catch (error) {
        if (error.code === 'ER_BAD_FIELD_ERROR') {
            try {
                const [fallback] = await db.execute(
                    `INSERT INTO invoices (student_id, amount, due_date, payment_gateway_url) 
                     VALUES (?, ?, ?, ?)`,
                    [student_id, amount, due_date, payment_gateway_url || null]
                );
                return res.status(201).json({ message: 'Tagihan SPP berhasil diterbitkan.', invoice_id: fallback.insertId });
            } catch (err2) {
                return res.status(500).json({ error: err2.message });
            }
        }
        res.status(500).json({ error: error.message });
    }
}

export async function getInvoices(req, res) {
    const { role, user_id } = req.user;
    try {
        let query = `
            SELECT 
                i.*,
                u.name AS student_name,
                u.email AS student_email
            FROM invoices i
            LEFT JOIN users u ON i.student_id = u.user_id
            WHERE 1=1
        `;
        const params = [];

        if (role === 'murid') {
            query += ' AND i.student_id = ?';
            params.push(user_id);
        }

        query += ' ORDER BY i.due_date DESC, i.invoice_id DESC';

        const [rows] = await db.execute(query, params);
        const normalized = rows.map((row) => {
            const proofUrl = row.payment_proof_url || row.proof_image_url || '';
            return {
                ...row,
                status: row.status || 'belum_bayar',
                payment_note: row.payment_note || '',
                payment_method: row.payment_method || '',
                payment_proof_url: proofUrl,
                proof_image_url: proofUrl
            };
        });
        res.json(normalized);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function createMidtransTransaction(req, res) {
    const { invoiceId } = req.params;
    const { payment_channel } = req.body || {};
    const { user_id, role } = req.user;

    try {
        if (!process.env.MIDTRANS_SERVER_KEY) {
            return res.status(500).json({ message: 'MIDTRANS_SERVER_KEY belum dikonfigurasi di environment.' });
        }

        const [rows] = await db.execute(
            `SELECT i.*, u.name AS student_name, u.email AS student_email, u.phone_number
             FROM invoices i
             LEFT JOIN users u ON i.student_id = u.user_id
             WHERE i.invoice_id = ?`,
            [invoiceId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Tagihan tidak ditemukan.' });
        }

        const invoice = rows[0];
        if (role === 'murid' && Number(invoice.student_id) !== Number(user_id)) {
            return res.status(403).json({ message: 'Akses ditolak.' });
        }

        if (invoice.status === 'lunas') {
            return res.status(400).json({ message: 'Tagihan ini sudah lunas.' });
        }

        const grossAmount = Math.round(Number(invoice.amount));
        if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
            return res.status(400).json({ message: 'Nominal tagihan tidak valid.' });
        }

        const orderId = `PRIVATKU-INV-${invoiceId}-${Date.now()}`;

        const channelToEnabledPayments = {
            gopay: ['gopay'],
            qris: ['qris', 'gopay'],
            bca_va: ['bca_va'],
            bni_va: ['bni_va'],
            mandiri_va: ['echannel'],
            bri_va: ['bri_va']
        };

        const parameter = {
            transaction_details: {
                order_id: orderId,
                gross_amount: grossAmount
            },
            item_details: [
                {
                    id: `INV-${invoiceId}`,
                    price: grossAmount,
                    quantity: 1,
                    name: `Tagihan SPP #${invoiceId}`.slice(0, 50)
                }
            ],
            customer_details: {
                first_name: invoice.student_name || 'Murid Privatku',
                email: invoice.student_email || 'murid@privatku.local',
                phone: invoice.phone_number || undefined
            }
        };

        if (payment_channel && channelToEnabledPayments[payment_channel]) {
            parameter.enabled_payments = channelToEnabledPayments[payment_channel];
        }

        const transaction = await snap.createTransaction(parameter);

        try {
            await db.execute(
                `UPDATE invoices 
                 SET payment_gateway_url = ? 
                 WHERE invoice_id = ?`,
                [transaction.redirect_url, invoiceId]
            );
        } catch (dbErr) {
            if (dbErr.code !== 'ER_BAD_FIELD_ERROR') {
                throw dbErr;
            }
        }

        res.json({
            message: 'Transaksi Midtrans Snap berhasil dibuat.',
            order_id: orderId,
            snap_token: transaction.token,
            redirect_url: transaction.redirect_url,
            payment_gateway_url: transaction.redirect_url,
            gross_amount: grossAmount
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function handleMidtransWebhook(req, res) {
    try {
        const notification = req.body || {};
        const {
            order_id,
            status_code,
            gross_amount,
            signature_key,
            transaction_status,
            fraud_status,
            payment_type
        } = notification;

        if (!order_id || !status_code || !gross_amount || !signature_key) {
            return res.status(400).json({ message: 'Payload notifikasi Midtrans tidak lengkap.' });
        }

        const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
        const expectedSignature = crypto
            .createHash('sha512')
            .update(`${order_id}${status_code}${gross_amount}${serverKey}`)
            .digest('hex');

        if (signature_key !== expectedSignature) {
            return res.status(401).json({ message: 'Signature key Midtrans tidak valid.' });
        }

        const invoiceId = extractInvoiceIdFromOrderId(order_id);
        if (!invoiceId) {
            return res.json({ message: 'Order ID diabaikan (bukan format invoice Privatku).' });
        }

        const [rows] = await db.execute('SELECT * FROM invoices WHERE invoice_id = ?', [invoiceId]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Tagihan tidak ditemukan.' });
        }

        let newStatus = null;
        let setPaidAt = false;

        if (transaction_status === 'capture') {
            if (fraud_status === 'accept' || !fraud_status) {
                newStatus = 'lunas';
                setPaidAt = true;
            } else if (fraud_status === 'challenge') {
                newStatus = 'menunggu_konfirmasi';
            }
        } else if (transaction_status === 'settlement') {
            newStatus = 'lunas';
            setPaidAt = true;
        } else if (transaction_status === 'pending') {
            newStatus = 'menunggu_konfirmasi';
        } else if (['deny', 'cancel', 'expire'].includes(transaction_status)) {
            newStatus = 'ditolak';
        }

        if (newStatus) {
            const methodValue = payment_type || 'midtrans';
            const noteValue = `Midtrans (${methodValue}) - ${transaction_status} [${order_id}]`;

            try {
                await db.execute(
                    `UPDATE invoices
                     SET status = ?,
                         payment_method = ?,
                         payment_note = ?,
                         paid_at = ${setPaidAt ? 'NOW()' : 'paid_at'}
                     WHERE invoice_id = ?`,
                    [newStatus, methodValue, noteValue, invoiceId]
                );
            } catch (err) {
                if (err.code === 'ER_BAD_FIELD_ERROR') {
                    await db.execute(
                        `UPDATE invoices
                         SET status = ?,
                             payment_note = ?,
                             paid_at = ${setPaidAt ? 'NOW()' : 'paid_at'}
                         WHERE invoice_id = ?`,
                        [newStatus, noteValue, invoiceId]
                    );
                } else {
                    throw err;
                }
            }
        }

        return res.json({
            message: 'Webhook Midtrans diproses.',
            invoice_id: invoiceId,
            transaction_status,
            status: newStatus
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function submitPaymentConfirmation(req, res) {
    const { invoiceId } = req.params;
    const { payment_note, payment_method, proof_image_base64 } = req.body;
    const { user_id, role } = req.user;

    try {
        const [rows] = await db.execute('SELECT * FROM invoices WHERE invoice_id = ?', [invoiceId]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Tagihan tidak ditemukan.' });
        }

        const invoice = rows[0];
        if (role === 'murid' && Number(invoice.student_id) !== Number(user_id)) {
            return res.status(403).json({ message: 'Anda tidak berhak mengonfirmasi tagihan ini.' });
        }

        if (invoice.status === 'lunas') {
            return res.status(400).json({ message: 'Tagihan ini sudah lunas.' });
        }

        let savedProofUrl = null;
        if (proof_image_base64 && String(proof_image_base64).trim() !== '') {
            const rawStr = String(proof_image_base64).trim();
            const dataUri = rawStr.startsWith('data:image/')
                ? rawStr
                : `data:image/jpeg;base64,${rawStr}`;

            const uploadResult = await cloudinary.uploader.upload(dataUri, {
                folder: 'privatku/payments',
                public_id: `inv_${invoiceId}_${Date.now()}`,
                resource_type: 'image'
            });

            savedProofUrl = uploadResult.secure_url;
        }

        const methodLabel = payment_method ? `[${payment_method}] ` : '';
        const baseNote = (payment_note && String(payment_note).trim() !== '')
            ? String(payment_note).trim()
            : 'Transfer Payment Gateway (Bukti terlampir)';
        const noteText = `${methodLabel}${baseNote}`;

        try {
            await db.execute(
                `UPDATE invoices 
                 SET status = 'menunggu_konfirmasi', 
                     payment_note = ?, 
                     payment_method = ?, 
                     payment_proof_url = COALESCE(?, payment_proof_url)
                 WHERE invoice_id = ?`,
                [noteText, payment_method || 'Midtrans Sandbox', savedProofUrl, invoiceId]
            );
        } catch (err) {
            if (err.code === 'ER_BAD_FIELD_ERROR') {
                const noteWithProof = savedProofUrl ? `${noteText} | Bukti: ${savedProofUrl}` : noteText;
                await db.execute(
                    `UPDATE invoices 
                     SET status = 'menunggu_konfirmasi', payment_note = ? 
                     WHERE invoice_id = ?`,
                    [noteWithProof, invoiceId]
                );
            } else {
                throw err;
            }
        }

        res.json({
            message: 'Pembayaran & bukti transfer berhasil dikirim. Menunggu konfirmasi Admin.',
            invoice_id: Number(invoiceId),
            status: 'menunggu_konfirmasi',
            payment_proof_url: savedProofUrl,
            proof_image_url: savedProofUrl
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function reviewPaymentConfirmation(req, res) {
    const { invoiceId } = req.params;
    const { action } = req.body; 

    try {
        if (!['lunas', 'ditolak'].includes(action)) {
            return res.status(400).json({ message: "Action harus 'lunas' atau 'ditolak'." });
        }

        const [rows] = await db.execute('SELECT * FROM invoices WHERE invoice_id = ?', [invoiceId]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Tagihan tidak ditemukan.' });
        }

        await db.execute(
            `UPDATE invoices 
             SET status = ?, paid_at = ${action === 'lunas' ? 'NOW()' : 'NULL'} 
             WHERE invoice_id = ?`,
            [action, invoiceId]
        );

        res.json({
            message: action === 'lunas'
                ? 'Pembayaran murid berhasil dikonfirmasi LUNAS.'
                : 'Pembayaran murid ditolak.',
            invoice_id: Number(invoiceId),
            status: action
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
