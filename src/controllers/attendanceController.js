import db from '../config/db.js';

function generateFiveDigitCode() {
    return String(Math.floor(10000 + Math.random() * 90000));
}

export async function openAttendanceSession(req, res) {
    const { schedule_id } = req.body;
    const { user_id, role } = req.user;

    try {
        if (!['tentor', 'admin'].includes(role)) {
            return res.status(403).json({ message: 'Hanya tentor atau admin yang dapat membuka sesi absensi.' });
        }
        if (!schedule_id) {
            return res.status(400).json({ message: 'schedule_id wajib diisi.' });
        }

        const [schedules] = await db.execute('SELECT * FROM schedules WHERE schedule_id = ?', [schedule_id]);
        if (schedules.length === 0) {
            return res.status(404).json({ message: 'Jadwal tidak ditemukan.' });
        }
        if (role === 'tentor' && Number(schedules[0].tutor_id) !== Number(user_id)) {
            return res.status(403).json({ message: 'Anda bukan tentor pengampu jadwal ini.' });
        }

        await db.execute(
            'UPDATE attendance_sessions SET is_open = 0, closed_at = NOW() WHERE schedule_id = ? AND is_open = 1',
            [schedule_id]
        );

        const code = generateFiveDigitCode();
        const [result] = await db.execute(
            `INSERT INTO attendance_sessions (schedule_id, tutor_id, verification_code, is_open, opened_at)
             VALUES (?, ?, ?, 1, NOW())`,
            [schedule_id, user_id, code]
        );

        res.status(201).json({
            message: 'Sesi absensi dibuka.',
            session_id: result.insertId,
            schedule_id: Number(schedule_id),
            verification_code: code,
            is_open: true
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function closeAttendanceSession(req, res) {
    const { schedule_id } = req.body;
    const { user_id, role } = req.user;

    try {
        if (!['tentor', 'admin'].includes(role)) {
            return res.status(403).json({ message: 'Akses ditolak.' });
        }
        if (!schedule_id) {
            return res.status(400).json({ message: 'schedule_id wajib diisi.' });
        }

        const [schedules] = await db.execute('SELECT * FROM schedules WHERE schedule_id = ?', [schedule_id]);
        if (schedules.length === 0) {
            return res.status(404).json({ message: 'Jadwal tidak ditemukan.' });
        }
        if (role === 'tentor' && Number(schedules[0].tutor_id) !== Number(user_id)) {
            return res.status(403).json({ message: 'Anda bukan tentor pengampu jadwal ini.' });
        }

        await db.execute(
            'UPDATE attendance_sessions SET is_open = 0, closed_at = NOW() WHERE schedule_id = ? AND is_open = 1',
            [schedule_id]
        );

        res.json({
            message: 'Sesi absensi telah ditutup.',
            schedule_id: Number(schedule_id),
            is_open: false
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function getActiveSessionStatus(req, res) {
    const { scheduleId } = req.params;
    try {
        const [rows] = await db.execute(
            `SELECT session_id, schedule_id, is_open, opened_at, closed_at
             FROM attendance_sessions
             WHERE schedule_id = ? AND is_open = 1
             ORDER BY session_id DESC LIMIT 1`,
            [scheduleId]
        );

        if (rows.length === 0) {
            return res.json({
                schedule_id: Number(scheduleId),
                is_open: false,
                message: 'Sesi absensi belum dibuka oleh tentor.'
            });
        }

        res.json({
            schedule_id: Number(scheduleId),
            session_id: rows[0].session_id,
            is_open: true,
            opened_at: rows[0].opened_at,
            message: 'Sesi absensi sedang dibuka.'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function getAttendances(req, res) {
    const { role, user_id } = req.user;
    try {
        let query = `
            SELECT
                a.*,
                u.name AS student_name,
                c.subject_name,
                c.grade_level,
                s.day_of_week,
                s.start_time,
                s.end_time,
                s.room_location
            FROM attendances a
            LEFT JOIN users u ON a.student_id = u.user_id
            LEFT JOIN schedules s ON a.schedule_id = s.schedule_id
            LEFT JOIN classes c ON s.class_id = c.class_id
            WHERE 1=1
        `;
        const params = [];

        if (role === 'murid') {
            query += ' AND a.student_id = ?';
            params.push(user_id);
        }

        query += ' ORDER BY a.scan_timestamp DESC, a.attendance_id DESC';
        const [rows] = await db.execute(query, params);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function createAttendance(req, res) {
    const { role, user_id } = req.user;
    const { schedule_id, student_id, status, notes, verification_code, latitude, longitude } = req.body;

    try {
        if (!schedule_id) {
            return res.status(400).json({ message: 'schedule_id wajib dipilih.' });
        }

        if (role === 'murid') {
            const targetStudentId = user_id;

            const [enrolled] = await db.execute(
                'SELECT * FROM enrollments WHERE student_id = ? AND schedule_id = ?',
                [targetStudentId, schedule_id]
            );
            if (enrolled.length === 0) {
                return res.status(403).json({ message: 'Anda belum terdaftar pada kelas/les ini.' });
            }

            const [sessions] = await db.execute(
                `SELECT * FROM attendance_sessions
                 WHERE schedule_id = ? AND is_open = 1
                 ORDER BY session_id DESC LIMIT 1`,
                [schedule_id]
            );
            if (sessions.length === 0) {
                return res.status(400).json({
                    message: 'Sesi absensi belum dibuka oleh tentor atau sudah ditutup.'
                });
            }

            const cleanCode = String(verification_code || '').trim();
            if (!/^\d{5}$/.test(cleanCode)) {
                return res.status(400).json({
                    message: 'Kode verifikasi 5 digit angka wajib diisi.'
                });
            }
            if (cleanCode !== String(sessions[0].verification_code)) {
                return res.status(401).json({
                    message: 'Kode verifikasi 5 digit tidak sesuai dengan sesi aktif tentor.'
                });
            }

            if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
                return res.status(400).json({
                    message: 'Lokasi perangkat (latitude & longitude) wajib aktif untuk absensi.'
                });
            }

            const finalNotes = (notes && String(notes).trim() !== '')
                ? String(notes).trim()
                : 'Hadir tepat waktu.';

            const [result] = await db.execute(
                `INSERT INTO attendances (schedule_id, student_id, status, notes, latitude, longitude, scan_timestamp)
                 VALUES (?, ?, 'Hadir', ?, ?, ?, NOW())`,
                [schedule_id, targetStudentId, finalNotes, Number(latitude), Number(longitude)]
            );

            return res.status(201).json({
                message: 'Hadir tepat waktu.',
                attendance_id: result.insertId
            });
        }

        if (!student_id) {
            return res.status(400).json({ message: 'student_id wajib dipilih.' });
        }

        const absenceStatus = status || 'Izin';
        const absenceNotes = (notes && String(notes).trim() !== '')
            ? String(notes).trim()
            : `Dicatat oleh ${role}`;

        const [result] = await db.execute(
            `INSERT INTO attendances (schedule_id, student_id, status, notes, scan_timestamp)
             VALUES (?, ?, ?, ?, NOW())`,
            [schedule_id, student_id, absenceStatus, absenceNotes]
        );

        res.status(201).json({
            message: `Status ${absenceStatus} berhasil dicatat.`,
            attendance_id: result.insertId
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
