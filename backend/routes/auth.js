const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

// ===============================================
// POST /api/register - ลงทะเบียนผู้ใช้ใหม่
// ===============================================
router.post('/register', async (req, res) => {
    try {
        const { email, password, fullName, studentId, phone, userType, faculty, major } = req.body;

        // ตรวจสอบข้อมูลที่จำเป็น
        if (!email || !password || !fullName) {
            return res.status(400).json({
                success: false,
                message: 'กรุณากรอกข้อมูลให้ครบถ้วน'
            });
        }

        // ตรวจสอบว่ามี email นี้อยู่แล้วหรือไม่
        const [existingUsers] = await db.execute(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'อีเมลนี้ถูกใช้งานแล้ว'
            });
        }

        // ตรวจสอบว่าเบอร์โทรศัพท์ซ้ำหรือไม่ (ถ้ามีการกรอกเบอร์)
        if (phone) {
            const [existingPhone] = await db.execute(
                'SELECT id FROM users WHERE phone = ?',
                [phone]
            );

            if (existingPhone.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `เบอร์ ${phone} มีในระบบแล้ว`
                });
            }
        }

        // เข้ารหัสรหัสผ่าน
        const hashedPassword = await bcrypt.hash(password, 10);

        // บันทึกผู้ใช้ใหม่
        const [result] = await db.execute(
            `INSERT INTO users (email, password, full_name, student_id, phone, user_type, faculty, major) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [email, hashedPassword, fullName, studentId || null, phone || null,
                userType || 'student', faculty || null, major || null]
        );

        res.status(201).json({
            success: true,
            message: 'ลงทะเบียนสำเร็จ',
            userId: result.insertId
        });

    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในระบบ'
        });
    }
});

// ===============================================
// POST /api/login - เข้าสู่ระบบ
// ===============================================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'กรุณากรอกอีเมลและรหัสผ่าน'
            });
        }

        // ค้นหาผู้ใช้ด้วย email หรือ student_id
        const [users] = await db.execute(
            'SELECT * FROM users WHERE email = ? OR student_id = ?',
            [email, email]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
            });
        }

        const user = users[0];

        // ตรวจสอบรหัสผ่าน
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
            });
        }

        // สร้าง JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: 'เข้าสู่ระบบสำเร็จ',
            token,
            user: {
                id: user.id,
                email: user.email,
                fullName: user.full_name,
                studentId: user.student_id,
                userType: user.user_type,
                role: user.role
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในระบบ'
        });
    }
});

// ===============================================
// GET /api/profile - ดึงข้อมูลโปรไฟล์
// ===============================================
router.get('/profile', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'กรุณาเข้าสู่ระบบ'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const [users] = await db.execute(
            'SELECT id, email, full_name, student_id, phone, faculty, major, user_type, role, created_at FROM users WHERE id = ?',
            [decoded.userId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบผู้ใช้งาน'
            });
        }

        res.json({
            success: true,
            user: users[0]
        });

    } catch (error) {
        console.error('Profile error:', error);
        res.status(401).json({
            success: false,
            message: 'Token ไม่ถูกต้อง'
        });
    }
});

// ===============================================
// PUT /api/profile - อัปเดตโปรไฟล์
// ===============================================
router.put('/profile', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { fullName, phone, faculty, major } = req.body;

        await db.execute(
            'UPDATE users SET full_name = ?, phone = ?, faculty = ?, major = ? WHERE id = ?',
            [fullName, phone, faculty, major, decoded.userId]
        );

        res.json({ success: true, message: 'อัปเดตข้อมูลสำเร็จ' });

    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

module.exports = router;
