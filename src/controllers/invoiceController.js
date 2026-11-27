import db from '../config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'payments');
fs.mkdirSync(uploadDir, { recursive: true });

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
        // Fallback jika kolom status belum ada di tabel invoices lama
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
        const normalized = rows.map((row) => ({
            ...row,
            status: row.status || 'belum_bayar',
            payment_note: row.payment_note || '',
            payment_method: row.payment_method || '',
            proof_image_url: row.proof_image_url || ''
        }));
        res.json(normalized);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Endpoint Simulasi / Dummy Midtrans Snap Token & VA Generator
export async function createMidtransDummyTransaction(req, res) {
    const { invoiceId } = req.params;
    const { payment_channel } = req.body; // 'bca_va', 'gopay', 'qris', 'bni_va', 'mandiri_va'
    const { user_id, role } = req.user;

    try {
        const [rows] = await db.execute('SELECT * FROM invoices WHERE invoice_id = ?', [invoiceId]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Tagihan tidak ditemukan.' });
        }

        const invoice = rows[0];
        if (role === 'murid' && Number(invoice.student_id) !== Number(user_id)) {
            return res.status(403).json({ message: 'Akses ditolak.' });
        }

        const channel = payment_channel || 'bca_va';
        const orderId = `PRIVATKU-INV-${invoiceId}-${Date.now()}`;
        const dummySnapToken = `snap-sandbox-${Math.random().toString(36).substring(2, 12)}-${invoiceId}`;
        const dummyVaMap = {
            bca_va: `88010${String(invoice.student_id).padStart(4, '0')}${String(invoiceId).padStart(4, '0')}`,
            bni_va: `98810${String(invoice.student_id).padStart(4, '0')}${String(invoiceId).padStart(4, '0')}`,
            mandiri_va: `70012${String(invoice.student_id).padStart(4, '0')}${String(invoiceId).padStart(4, '0')}`,
            gopay: 'QRIS / GoPay Instant Sandbox',
            qris: 'QRIS All E-Wallet Sandbox'
        };

        res.json({
            message: 'Transaksi Payment Gateway (Midtrans Sandbox Dummy) siap.',
            order_id: orderId,
            snap_token: dummySnapToken,
            redirect_url: `https://app.sandbox.midtrans.com/snap/v4/redirection/${dummySnapToken}`,
            payment_channel: channel,
            va_number: dummyVaMap[channel] || dummyVaMap.bca_va,
            gross_amount: Number(invoice.amount),
            expiry_minutes: 60
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Murid mengajukan konfirmasi pembayaran (mendukung bukti transfer gambar base64 + metode gateway)
export async function submitPaymentConfirmation(req, res) {
    const { invoiceId } = req.params;
    const { payment_note, payment_method, proof_image_base64, proof_filename } = req.body;
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
            const rawBase64 = String(proof_image_base64).replace(/^data:image\/\w+;base64,/, '');
            const extMatch = String(proof_filename || 'bukti.jpg').match(/\.(png|jpg|jpeg|webp)$/i);
            const ext = extMatch ? extMatch[0].toLowerCase() : '.jpg';
            const filename = `inv_${invoiceId}_${Date.now()}${ext}`;
            const fullPath = path.join(uploadDir, filename);
            fs.writeFileSync(fullPath, Buffer.from(rawBase64, 'base64'));
            savedProofUrl = `/uploads/payments/${filename}`;
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
                     proof_image_url = COALESCE(?, proof_image_url)
                 WHERE invoice_id = ?`,
                [noteText, payment_method || 'Midtrans Sandbox', savedProofUrl, invoiceId]
            );
        } catch (err) {
            // Fallback apabila kolom payment_method / proof_image_url belum ditambahkan via ALTER TABLE
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
            proof_image_url: savedProofUrl
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Admin menyetujui (lunas) atau menolak (ditolak) pembayaran murid
export async function reviewPaymentConfirmation(req, res) {
    const { invoiceId } = req.params;
    const { action } = req.body; // 'lunas' atau 'ditolak'

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
