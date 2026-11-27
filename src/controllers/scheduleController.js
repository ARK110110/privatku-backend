import db from '../config/db.js';

export async function createSchedule(req, res) {
    const { class_id, tutor_id, day_of_week, start_time, end_time, room_location } = req.body;
    try {
        if (!class_id || !tutor_id || !day_of_week || !start_time || !end_time) {
            return res.status(400).json({ message: 'Data jadwal belum lengkap.' });
        }

        const [clashing] = await db.execute(
            `SELECT schedule_id FROM schedules 
             WHERE tutor_id = ? AND day_of_week = ? 
             AND ((start_time < ? AND end_time > ?) OR (start_time < ? AND end_time > ?))`,
            [tutor_id, day_of_week, end_time, start_time, end_time, start_time]
        );

        if (clashing.length > 0) {
            return res.status(400).json({ message: 'Bentrok jadwal terdeteksi untuk tentor ini pada jam tersebut!' });
        }

        const [result] = await db.execute(
            `INSERT INTO schedules (class_id, tutor_id, day_of_week, start_time, end_time, room_location) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [class_id, tutor_id, day_of_week, start_time, end_time, room_location || 'Ruang Privat']
        );
        res.status(201).json({ message: 'Jadwal berhasil ditambahkan.', schedule_id: result.insertId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function getSchedules(req, res) {
    const { day_of_week } = req.query;
    const { user_id, role } = req.user;

    try {
        let query = `
            SELECT 
                s.schedule_id,
                s.class_id,
                s.tutor_id,
                s.day_of_week,
                s.start_time,
                s.end_time,
                s.room_location,
                c.*,
                u.name AS tutor_name
            FROM schedules s
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN users u ON s.tutor_id = u.user_id
        `;
        const params = [];

        if (role === 'murid') {
            query += ' INNER JOIN enrollments e ON s.schedule_id = e.schedule_id WHERE e.student_id = ?';
            params.push(user_id);
        } else if (role === 'tentor') {
            query += ' WHERE s.tutor_id = ?';
            params.push(user_id);
        } else {
            query += ' WHERE 1=1';
        }

        if (day_of_week && day_of_week !== 'Semua') {
            query += ' AND s.day_of_week = ?';
            params.push(day_of_week);
        }

        query += ' ORDER BY s.start_time ASC';

        const [rows] = await db.execute(query, params);
        const normalized = rows.map((r) => ({
            ...r,
            description: r.description || `Kelas bimbingan ${r.subject_name || ''} tingkat ${r.grade_level || ''} bersama ${r.tutor_name || 'Tentor'}.`
        }));
        res.json(normalized);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
