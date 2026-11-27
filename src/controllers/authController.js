import db from '../config/db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

export async function login(req, res) {
    const { email, password } = req.body;
    try {
        if (!email || !password) {
            return res.status(400).json({ message: 'Email dan kata sandi wajib diisi.' });
        }

        const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
        }

        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Kata sandi salah.' });
        }

        const token = jwt.sign(
            { user_id: user.user_id, role: user.role, name: user.name },
            process.env.JWT_SECRET || 'secret_key'
        );

        res.json({
            message: 'Login berhasil',
            token,
            user: {
                user_id: user.user_id,
                name: user.name,
                email: user.email,
                phone_number: user.phone_number,
                role: user.role
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function register(req, res) {
    const { name, phone_number, email, password } = req.body;
    try {
        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Nama, email, dan password wajib diisi.'
            });
        }

        const [existedUser] = await db.execute(
            'SELECT user_id FROM users WHERE email = ?',
            [email]
        );
        if (existedUser.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Email sudah digunakan.'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await db.execute(
            `INSERT INTO users (role, name, phone_number, email, password)
             VALUES (?, ?, ?, ?, ?)`,
            ['murid', name, phone_number || null, email, hashedPassword]
        );

        res.status(201).json({
            success: true,
            message: 'Registrasi berhasil, silakan login.',
            user_id: result.insertId
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function getMe(req, res) {
    try {
        const [rows] = await db.execute(
            'SELECT user_id, name, phone_number, email, role FROM users WHERE user_id = ?',
            [req.user.user_id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'User tidak ditemukan.' });
        }
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function getStudents(req, res) {
    try {
        const [rows] = await db.execute(
            "SELECT user_id, name, email, phone_number, role FROM users WHERE role = 'murid' ORDER BY name ASC"
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function getTutors(req, res) {
    try {
        const [rows] = await db.execute(
            "SELECT user_id, name, email, phone_number, role FROM users WHERE role = 'tentor' ORDER BY name ASC"
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function getAllUsers(req, res) {
    try {
        const [rows] = await db.execute(
            "SELECT user_id, name, email, phone_number, role FROM users ORDER BY user_id DESC"
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function updateUserRole(req, res) {
    const { userId } = req.params;
    const { role } = req.body;
    const allowedRoles = ['murid', 'tentor', 'admin'];

    try {
        if (!allowedRoles.includes(role)) {
            return res.status(400).json({ message: 'Role tidak valid. Gunakan murid, tentor, atau admin.' });
        }

        const [existing] = await db.execute('SELECT user_id, name, role FROM users WHERE user_id = ?', [userId]);
        if (existing.length === 0) {
            return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
        }

        await db.execute('UPDATE users SET role = ? WHERE user_id = ?', [role, userId]);
        res.json({
            message: `Role ${existing[0].name} berhasil diubah menjadi ${role}.`,
            user_id: Number(userId),
            role
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
