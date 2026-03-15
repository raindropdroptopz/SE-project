const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ===============================================
// POST /api/register - สมัครสมาชิก
// ===============================================
router.post('/register', async (req, res) => {
    try {
        const { email, password, fullName, studentId, phone, userType, faculty, major } = req.body;

        // ตรวจสอบข้อมูลที่จำเป็น
        if (!email || !password || !fullName) {
            return res.status(400).json({ success: false, message: 'กรุณากรอก Email, รหัสผ่าน และชื่อ-นามสกุล' });
        }

        // ตรวจสอบว่า email ซ้ำหรือไม่
        const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'อีเมลนี้ถูกใช้งานแล้ว' });
        }

        // เข้ารหัสรหัสผ่าน
        const hashedPassword = await bcrypt.hash(password, 10);

        // บันทึกข้อมูลผู้ใช้
        await db.execute(
            'INSERT INTO users (email, password, full_name, student_id, phone, user_type, faculty, major) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [email, hashedPassword, fullName, studentId || null, phone || null, userType || 'student', faculty || null, major || null]
        );

        res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ' });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// POST /api/login - เข้าสู่ระบบ
// ===============================================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'กรุณากรอก Email และรหัสผ่าน' });
        }

        // ค้นหาผู้ใช้จาก email
        const [users] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
        }

        const user = users[0];

        // ตรวจสอบสถานะผู้ใช้
        if (user.status === 'suspended') {
            return res.status(403).json({ success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน' });
        }

        // ตรวจสอบรหัสผ่าน
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
        }

        // สร้าง JWT Token
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
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
                role: user.role,
                userType: user.user_type
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ตั้งค่าที่เก็บไฟล์รูปโปรไฟล์
const profileUploadDir = path.join(__dirname, '../../frontend/uploads/profiles');
if (!fs.existsSync(profileUploadDir)) {
    fs.mkdirSync(profileUploadDir, { recursive: true });
}

const profileStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, profileUploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, 'profile-' + Date.now() + path.extname(file.originalname));
    }
});

const uploadProfile = multer({ storage: profileStorage });

// Middleware ตรวจสอบ Token
const authenticateToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Token ไม่ถูกต้อง' });
    }
};

// ===============================================
// POST /api/auth/profile-image - อัปโหลดรูปโปรไฟล์
// ===============================================
router.post('/profile-image', authenticateToken, uploadProfile.single('profileImage'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'กรุณาเลือกไฟล์รูปภาพ' });
        }

        const imageUrl = '/uploads/profiles/' + req.file.filename;
        await db.execute('UPDATE users SET profile_image = ? WHERE id = ?', [imageUrl, req.user.userId]);

        res.json({ success: true, message: 'อัปเดตรูปโปรไฟล์สำเร็จ', imageUrl });
    } catch (error) {
        console.error('Upload profile image error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// GET /api/profile - ดึงข้อมูลโปรไฟล์ + สถิติ
// ===============================================
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        // 1. ดึงข้อมูลพื้นฐานผู้ใช้
        const [users] = await db.execute(
            'SELECT id, email, full_name, student_id, phone, faculty, major, user_type, role, profile_image, created_at FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งาน' });
        }

        const user = users[0];

        // 2. ดึงสถิติการจอง
        const [stats] = await db.execute(`
            SELECT 
                COUNT(CASE WHEN status IN ('pending', 'confirmed') THEN 1 END) as active_count,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
                COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_count
            FROM bookings 
            WHERE user_id = ?
        `, [userId]);

        res.json({
            success: true,
            user: user,
            stats: stats[0]
        });

    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
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
