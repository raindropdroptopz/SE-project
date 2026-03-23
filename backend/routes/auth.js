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

        // 1. ตรวจสอบชื่อ-นามสกุล (ไทย-อังกฤษ และเว้นวรรค เท่านั้น)
        const nameRegex = /^[a-zA-Z\u0E00-\u0E7F\s]+$/;
        if (!nameRegex.test(fullName)) {
            return res.status(400).json({ success: false, message: 'ชื่อและนามสกุลต้องเป็นตัวอักษรไทยหรืออังกฤษเท่านั้น' });
        }

        // 2. ตรวจสอบรหัสผ่าน (8-16 ตัว, พิมพ์ใหญ่, พิมพ์เล็ก, ตัวเลข)
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,16}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({ success: false, message: 'รหัสผ่านต้องมี 8-16 ตัว ประกอบด้วยตัวพิมพ์เล็ก, ตัวพิมพ์ใหญ่ และตัวเลขอย่างน้อยหนึ่งตัว' });
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

        // สร้าง JWT Token เมื่ออีเมลถูกต้อง
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
            'SELECT id, email, full_name, student_id, phone, faculty, major, user_type, role, created_at FROM users WHERE id = ?',
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
router.put('/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { fullName, phone, faculty, major, email } = req.body;

        if (!fullName || fullName.trim() === '') {
            return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อ-นามสกุล' });
        }

        // Check email duplicate if email is being changed
        if (email && email.trim() !== '') {
            const [emailCheck] = await db.execute(
                'SELECT id FROM users WHERE email = ? AND id != ?',
                [email.trim(), userId]
            );
            if (emailCheck.length > 0) {
                return res.status(409).json({ success: false, message: 'อีเมลนี้มีการใช้แล้ว กรุณากรอกอีเมลใหม่ ที่ไม่ซ้ำ' });
            }

            await db.execute(
                'UPDATE users SET full_name = ?, phone = ?, faculty = ?, major = ?, email = ? WHERE id = ?',
                [fullName.trim(), phone || null, faculty || null, major || null, email.trim(), userId]
            );
        } else {
            await db.execute(
                'UPDATE users SET full_name = ?, phone = ?, faculty = ?, major = ? WHERE id = ?',
                [fullName.trim(), phone || null, faculty || null, major || null, userId]
            );
        }

        // Return updated user data
        const [users] = await db.execute(
            'SELECT id, email, full_name, student_id, phone, faculty, major, user_type, role FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งาน' });
        }

        res.json({ success: true, message: 'อัปเดตข้อมูลสำเร็จ', user: users[0] });

    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});


// ===============================================
// POST /api/auth/forgot-password - ขอ reset รหัสผ่าน
// ===============================================
router.post('/auth/forgot-password', async (req, res) => {
    const { email } = req.body;

    // ส่ง response เหมือนกันเสมอ ป้องกัน User Enumeration
    const safeResponse = () => res.json({
        success: true,
        message: 'หากอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์กู้คืนรหัสผ่านไปให้คุณแล้ว กรุณาตรวจสอบกล่องจดหมายของคุณ'
    });

    try {
        if (!email) {
            return res.status(400).json({ success: false, message: 'กรุณากรอกอีเมล' });
        }

        // ตรวจสอบว่าอีเมลมีในระบบ
        const [users] = await db.execute('SELECT id, email, full_name FROM users WHERE email = ?', [email]);

        // ถ้าไม่มีผู้ใช้ ก็ return safe response
        if (users.length === 0) {
            return safeResponse();
        }

        const user = users[0];

        // ลบ token เก่าของผู้ใช้นี้ (ถ้ามี)
        await db.execute('DELETE FROM password_resets WHERE user_id = ?', [user.id]);

        // สร้าง plain token (32 bytes = 64 hex chars)
        const plainToken = crypto.randomBytes(32).toString('hex');

        // Hash token ก่อนเก็บใน DB (SHA-256)
        const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');

        // กำหนดวันหมดอายุ 30 นาที
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

        // บันทึก hashed token ลง DB
        await db.execute(
            'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
            [user.id, hashedToken, expiresAt]
        );

        // สร้างลิงก์
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const resetLink = `${baseUrl}/resetpass.html?token=${plainToken}`;

        // ตั้งค่า nodemailer
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const mailOptions = {
            from: `"Payap Sports" <${process.env.EMAIL_USER}>`,
            to: user.email,
            subject: 'รีเซ็ตรหัสผ่าน - Payap Sports',
            html: `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background: #f8f9fa;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 15px 15px 0 0; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 24px;">🔐 รีเซ็ตรหัสผ่าน</h1>
                        <p style="color: rgba(255,255,255,0.85); margin: 10px 0 0;">Payap Sports Reservation System</p>
                    </div>
                    <div style="background: white; padding: 30px; border-radius: 0 0 15px 15px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                        <p style="color: #333; font-size: 16px;">สวัสดีคุณ <strong>${user.full_name}</strong>,</p>
                        <p style="color: #666;">เราได้รับคำร้องขอการรีเซ็ตรหัสผ่านสำหรับบัญชีของคุณ กรุณาคลิกปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${resetLink}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 40px; border-radius: 50px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
                                ตั้งรหัสผ่านใหม่
                            </a>
                        </div>
                        <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 8px; margin: 20px 0;">
                            <p style="color: #856404; margin: 0; font-size: 14px;">
                                ⚠️ ลิงก์นี้จะหมดอายุใน <strong>30 นาที</strong><br>
                                หากคุณไม่ได้ร้องขอการรีเซ็ตรหัสผ่าน กรุณาเพิกเฉยต่ออีเมลนี้
                            </p>
                        </div>
                        <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">หากปุ่มด้านบนไม่ทำงาน คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์:<br>
                            <span style="color: #667eea; word-break: break-all;">${resetLink}</span>
                        </p>
                    </div>
                </div>
            `
        };

        // ส่ง email (ถ้าตั้งค่า Gmail ไว้แล้ว)
        if (process.env.EMAIL_USER && process.env.EMAIL_USER !== 'your_email@gmail.com') {
            try {
                await transporter.sendMail(mailOptions);
                console.log(`✅ Reset email sent to: ${user.email}`);
            } catch (emailError) {
                console.error('❌ Email send error:', emailError.message);
                // Log link ใน console สำหรับการทดสอบ
                console.log('🔗 [DEV] Reset link:', resetLink);
            }
        } else {
            // โหมด dev: log link ใน console แทน
            console.log('==============================================');
            console.log('📧 [DEV MODE] Reset password link:');
            console.log('   Email:', user.email);
            console.log('   Link:', resetLink);
            console.log('   Expires:', expiresAt.toLocaleString('th-TH'));
            console.log('==============================================');
        }

        return safeResponse();

    } catch (error) {
        console.error('Forgot password error:', error);
        return safeResponse(); // ยังคง return safe response แม้เกิด error
    }
});

// ===============================================
// GET /api/auth/reset-password?token=xxx - ตรวจสอบความถูกต้องของ token
// ===============================================
router.get('/auth/reset-password', async (req, res) => {
    try {
        const { token } = req.query;

        if (!token) {
            return res.json({ valid: false, message: 'ไม่พบ token' });
        }

        // Hash token ที่รับมาก่อนค้นหา
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const [rows] = await db.execute(
            'SELECT * FROM password_resets WHERE token = ?',
            [hashedToken]
        );

        if (rows.length === 0) {
            return res.json({ valid: false, message: 'ลิงก์นี้ไม่ถูกต้องหรือหมดอายุแล้ว' });
        }

        const resetRecord = rows[0];

        // ตรวจสอบว่าถูกใช้ไปแล้วหรือยัง
        if (resetRecord.used) {
            return res.json({ valid: false, message: 'ลิงก์นี้ถูกใช้งานแล้ว กรุณาขอลิงก์ใหม่' });
        }

        // ตรวจสอบวันหมดอายุ
        if (new Date() > new Date(resetRecord.expires_at)) {
            return res.json({ valid: false, message: 'ลิงก์นี้หมดอายุแล้ว กรุณาขอลิงก์ใหม่' });
        }

        res.json({ valid: true });

    } catch (error) {
        console.error('Verify token error:', error);
        res.json({ valid: false, message: 'เกิดข้อผิดพลาดในการตรวจสอบ token' });
    }
});

// ===============================================
// POST /api/auth/reset-password - ตั้งรหัสผ่านใหม่
// ===============================================
router.post('/auth/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
        }

        // ตรวจสอบรหัสผ่านใหม่ (ต้องมี 8-16 ตัว, พิมพ์ใหญ่, พิมพ์เล็ก, ตัวเลข)
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,16}$/;
        if (!passwordRegex.test(newPassword)) {
            return res.status(400).json({
                success: false,
                message: 'รหัสผ่านต้องมี 8-16 ตัว ประกอบด้วยตัวพิมพ์เล็ก, ตัวพิมพ์ใหญ่ และตัวเลขอย่างน้อยหนึ่งตัว'
            });
        }

        // Hash token ที่รับมาก่อนค้นหา
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const [rows] = await db.execute(
            'SELECT pr.*, u.email, u.full_name FROM password_resets pr JOIN users u ON pr.user_id = u.id WHERE pr.token = ?',
            [hashedToken]
        );

        if (rows.length === 0) {
            return res.status(400).json({ success: false, message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว' });
        }

        const resetRecord = rows[0];

        // ตรวจสอบว่าถูกใช้แล้วหรือยัง
        if (resetRecord.used) {
            return res.status(400).json({ success: false, message: 'ลิงก์นี้ถูกใช้งานแล้ว กรุณาขอลิงก์ใหม่' });
        }

        // ตรวจสอบวันหมดอายุ
        if (new Date() > new Date(resetRecord.expires_at)) {
            return res.status(400).json({ success: false, message: 'ลิงก์นี้หมดอายุแล้ว กรุณาขอลิงก์ใหม่' });
        }

        // Hash รหัสผ่านใหม่
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // อัปเดตรหัสผ่านใน users
        await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, resetRecord.user_id]);

        // Mark token ว่าใช้แล้ว (ป้องกันการใช้ซ้ำ)
        await db.execute('UPDATE password_resets SET used = 1 WHERE id = ?', [resetRecord.id]);

        console.log(`✅ Password reset successful for: ${resetRecord.email}`);

        // ส่ง email แจ้งเตือนว่ารหัสผ่านถูกเปลี่ยน (ถ้าตั้งค่า email ไว้)
        if (process.env.EMAIL_USER && process.env.EMAIL_USER !== 'your_email@gmail.com') {
            try {
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                        user: process.env.EMAIL_USER,
                        pass: process.env.EMAIL_PASS
                    }
                });

                await transporter.sendMail({
                    from: `"Payap Sports" <${process.env.EMAIL_USER}>`,
                    to: resetRecord.email,
                    subject: '✅ รหัสผ่านของคุณถูกเปลี่ยนเรียบร้อยแล้ว - Payap Sports',
                    html: `
                        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background: #f8f9fa;">
                            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 15px; text-align: center;">
                                <h1 style="color: white; margin: 0;">✅ รหัสผ่านถูกเปลี่ยนแล้ว</h1>
                            </div>
                            <div style="background: white; padding: 30px; border-radius: 0 0 15px 15px;">
                                <p>สวัสดีคุณ <strong>${resetRecord.full_name}</strong>,</p>
                                <p>รหัสผ่านของบัญชี <strong>${resetRecord.email}</strong> ถูกเปลี่ยนเรียบร้อยแล้ว</p>
                                <p style="color: #dc3545;"><strong>หากคุณไม่ได้ดำเนินการนี้ กรุณาติดต่อเจ้าหน้าที่ทันที</strong></p>
                                <a href="${process.env.BASE_URL}/login.html" style="background: #667eea; color: white; padding: 12px 30px; border-radius: 50px; text-decoration: none; display: inline-block; margin-top: 15px;">
                                    เข้าสู่ระบบ
                                </a>
                            </div>
                        </div>
                    `
                });
            } catch (emailError) {
                console.error('Notification email error:', emailError.message);
            }
        }

        res.json({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่' });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// GET /api/stats - สถิติสาธารณะ (ไม่ต้อง login)
// ===============================================
router.get('/stats', async (req, res) => {
    try {
        const [[{ totalCourts }]] = await db.execute(
            "SELECT COUNT(*) as totalCourts FROM courts WHERE status != 'maintenance'"
        );
        const [[{ totalEquipment }]] = await db.execute(
            "SELECT COUNT(*) as totalEquipment FROM equipment"
        );
        const [[{ totalUsers }]] = await db.execute(
            "SELECT COUNT(*) as totalUsers FROM users WHERE role != 'admin'"
        );

        res.json({
            success: true,
            courts: totalCourts || 0,
            equipment: totalEquipment || 0,
            users: totalUsers || 0
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

module.exports = router;


