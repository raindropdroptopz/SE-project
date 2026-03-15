const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// ตั้งค่า Email Transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ===============================================
// POST /api/auth/forgot-password - ขอรีเซ็ตรหัสผ่าน
// ===============================================
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: 'กรุณากรอกอีเมล' });
        }

        // 1. ตรวจสอบว่ามีอีเมลในระบบหรือไม่
        const [users] = await db.execute('SELECT id, full_name FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            // เพื่อความปลอดภัย ไม่ควรบอกว่าไม่มีอีเมลนี้ แต่ในที่นี้เราจะบอกตามจริงเพื่อให้ผู้ใช้แก้ไขได้
            return res.status(404).json({ success: false, message: 'ไม่พบอีเมลนี้ในระบบ' });
        }

        const user = users[0];

        // 2. สร้าง Token และเวลาหมดอายุ (1 ชม.)
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 3600000); // 1 hour

        // 3. บันทึกลงฐานข้อมูล
        await db.execute(
            'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
            [user.id, token, expiresAt]
        );

        // 4. ส่งอีเมล
        const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/resetpass.html?token=${token}`;
        
        const mailOptions = {
            from: `"Payap Sports" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'รีเซ็ตรหัสผ่าน - Payap Sports Reservation System',
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #667eea; text-align: center;">รีเซ็ตรหัสผ่าน</h2>
                    <p>สวัสดีคุณ <b>${user.full_name}</b>,</p>
                    <p>คุณได้รับอีเมลนี้เนื่องจากมีการขอรีเซ็ตรหัสผ่านสำหรับบัญชีของคุณในระบบ Payap Sports</p>
                    <p>กรุณาคลิกที่ปุ่มด้านล่างเพื่อดำเนินการรีเซ็ตรหัสผ่าน (ลิงก์นี้จะมีอายุ 1 ชั่วโมง):</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetLink}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">รีเซ็ตรหัสผ่านใหม่</a>
                    </div>
                    <p>หรือคัดลอกลิงก์นี้ไปวางในเบราว์เซอร์ของคุณ:</p>
                    <p style="word-break: break-all; color: #667eea;">${resetLink}</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="font-size: 12px; color: #999;">หากคุณไม่ได้เป็นผู้ส่งคำขอนี้ โปรดเพิกเฉยต่ออีเมลฉบับนี้</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);

        res.json({ success: true, message: 'ส่งลิงก์รีเซ็ตรหัสผ่านไปยังอีเมลของคุณเรียบร้อยแล้ว' });

    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการส่งอีเมล' });
    }
});

// ===============================================
// POST /api/auth/reset-password - รีเซ็ตรหัสผ่านใหม่ด้วย Token
// ===============================================
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
        }

        // 1. ตรวจสอบ Token และวันหมดอายุ
        const [resets] = await db.execute(
            'SELECT * FROM password_resets WHERE token = ? AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
            [token]
        );

        if (resets.length === 0) {
            return res.status(400).json({ success: false, message: 'Token ไม่ถูกต้อง หรือหมดอายุแล้ว' });
        }

        const resetEntry = resets[0];

        // 2. Hash รหัสผ่านใหม่
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // 3. อัปเดตรหัสผ่านผู้ใช้
        await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, resetEntry.user_id]);

        // 4. ลบ Token ที่ใช้แล้ว
        await db.execute('DELETE FROM password_resets WHERE user_id = ?', [resetEntry.user_id]);

        res.json({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่' });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

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
