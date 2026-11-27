import db from '../config/db.js';

export async function createClass(req, res) {
    const { institution_id, subject_name, grade_level, fee_scheme, price, description } = req.body;
    try {
        if (!subject_name || !grade_level || !fee_scheme || price === undefined || price === null) {
            return res.status(400).json({ message: 'subject_name, grade_level, fee_scheme, dan price wajib diisi.' });
        }

        const instId = institution_id || 1;
        const descText = (description && String(description).trim() !== '')
            ? String(description).trim()
            : `Program bimbingan belajar ${subject_name} tingkat ${grade_level} dengan pendampingan intensif sesuai kurikulum.`;

        try {
            const [result] = await db.execute(
                'INSERT INTO classes (institution_id, subject_name, grade_level, fee_scheme, price, description) VALUES (?, ?, ?, ?, ?, ?)',
                [instId, subject_name, grade_level, fee_scheme, price, descText]
            );
            return res.status(201).json({ message: 'Kelas berhasil dibuat.', class_id: result.insertId });
        } catch (err) {
            if (err.code === 'ER_BAD_FIELD_ERROR') {
                const [fallback] = await db.execute(
                    'INSERT INTO classes (institution_id, subject_name, grade_level, fee_scheme, price) VALUES (?, ?, ?, ?, ?)',
                    [instId, subject_name, grade_level, fee_scheme, price]
                );
                return res.status(201).json({ message: 'Kelas berhasil dibuat.', class_id: fallback.insertId });
            }
            throw err;
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function getClasses(req, res) {
    try {
        const [rows] = await db.execute('SELECT * FROM classes ORDER BY class_id DESC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
