import db from '../config/db.js';

function timeToMinutes(t) {
    if (!t) return 0;
    const parts = String(t).split(':').map((n) => parseInt(n, 10) || 0);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
}

// Murid mendaftar ke salah satu jadwal les (dengan pengecekan bentrok hari & jam)
export async function enrollSchedule(req, res) {
    const student_id = req.user.user_id;
    const { schedule_id, force_enroll } = req.body;

    try {
        if (!schedule_id) {
            return res.status(400).json({ message: 'schedule_id wajib diisi.' });
        }

        // Ambil detail jadwal target
        const [schedules] = await db.execute(
            `SELECT s.schedule_id, s.day_of_week, s.start_time, s.end_time, c.subject_name, c.price 
             FROM schedules s 
             JOIN classes c ON s.class_id = c.class_id 
             WHERE s.schedule_id = ?`,
            [schedule_id]
        );
        if (schedules.length === 0) {
            return res.status(404).json({ message: 'Jadwal tidak ditemukan.' });
        }

        const target = schedules[0];

        // Cek duplikasi pendaftaran
        const [existing] = await db.execute(
            'SELECT enrollment_id FROM enrollments WHERE student_id = ? AND schedule_id = ?',
            [student_id, schedule_id]
        );
        if (existing.length > 0) {
            return res.status(400).json({ message: 'Kamu sudah terdaftar di jadwal les ini.' });
        }

        // Cek bentrok jadwal di hari yang sama & jam bertabrakan
        const [mySchedules] = await db.execute(
            `SELECT s.schedule_id, s.day_of_week, s.start_time, s.end_time, c.subject_name
             FROM enrollments e
             JOIN schedules s ON e.schedule_id = s.schedule_id
             JOIN classes c ON s.class_id = c.class_id
             WHERE e.student_id = ? AND s.day_of_week = ?`,
            [student_id, target.day_of_week]
        );

        const targetStart = timeToMinutes(target.start_time);
        const targetEnd = timeToMinutes(target.end_time);

        const conflicts = mySchedules.filter((item) => {
            const existStart = timeToMinutes(item.start_time);
            const existEnd = timeToMinutes(item.end_time);
            return targetStart < existEnd && targetEnd > existStart;
        });

        if (conflicts.length > 0 && !force_enroll) {
            const conflictNames = conflicts
                .map((c) => `${c.subject_name} (${String(c.start_time).slice(0, 5)} - ${String(c.end_time).slice(0, 5)})`)
                .join(', ');
            return res.status(409).json({
                conflict: true,
                message: `Jadwal bentrok di hari ${target.day_of_week} dengan kelas: ${conflictNames}. Silakan pilih jadwal/kelas lain.`,
                conflicts
            });
        }

        await db.execute(
            'INSERT INTO enrollments (student_id, schedule_id) VALUES (?, ?)',
            [student_id, schedule_id]
        );

        res.status(201).json({ message: 'Berhasil mendaftar ke jadwal les!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Murid membatalkan / berhenti mengikuti les
export async function unenrollSchedule(req, res) {
    const student_id = req.user.user_id;
    const { scheduleId } = req.params;

    try {
        const [existing] = await db.execute(
            'SELECT enrollment_id FROM enrollments WHERE student_id = ? AND schedule_id = ?',
            [student_id, scheduleId]
        );
        if (existing.length === 0) {
            return res.status(404).json({ message: 'Data pendaftaran les tidak ditemukan.' });
        }

        await db.execute(
            'DELETE FROM enrollments WHERE student_id = ? AND schedule_id = ?',
            [student_id, scheduleId]
        );

        res.json({ message: 'Kamu telah berhenti mengikuti les ini.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Katalog semua jadwal yang tersedia (untuk dipilih murid) + status apakah sudah diambil & detail kelas
export async function getAvailableSchedules(req, res) {
    const student_id = req.user.user_id;
    try {
        const [rows] = await db.execute(
            `SELECT 
                s.schedule_id,
                s.class_id,
                s.tutor_id,
                s.day_of_week,
                s.start_time,
                s.end_time,
                s.room_location,
                c.*,
                u.name AS tutor_name,
                CASE WHEN e.enrollment_id IS NOT NULL THEN 1 ELSE 0 END AS is_enrolled
             FROM schedules s
             JOIN classes c ON s.class_id = c.class_id
             JOIN users u ON s.tutor_id = u.user_id
             LEFT JOIN enrollments e ON s.schedule_id = e.schedule_id AND e.student_id = ?
             ORDER BY c.subject_name ASC, s.day_of_week ASC`,
            [student_id]
        );

        const normalized = rows.map((row) => ({
            ...row,
            description:
                row.description ||
                `Kelas bimbingan belajar ${row.subject_name} (${row.grade_level}) dibimbing langsung oleh ${row.tutor_name} dengan materi terstruktur dan latihan soal.`
        }));

        res.json(normalized);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
