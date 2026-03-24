const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');     // ใช้สำหรับเข้ารหัสผ่าน (Hashing) เพื่อความปลอดภัย
const jwt = require('jsonwebtoken');    // ใช้สำหรับสร้างและตรวจสอบ Token การเข้าสู่ระบบ
const db = require('../lib/db');        // เรียกใช้การเชื่อมต่อ Database
const crypto = require('crypto');       // ใช้สร้างรหัสสุ่ม (Random Token) สำหรับรีเซ็ตรหัสผ่าน
const nodemailer = require('nodemailer'); // ใช้สำหรับส่งอีเมล
const multer = require('multer');       // ใช้สำหรับจัดการอัปโหลดไฟล์ (รูปภาพ)
const path = require('path');
const fs = require('fs');

/**
 * =========================================================================
 * 1. ฟังก์ชัน สมัครสมาชิก (Register)
 * =========================================================================
 * หน้าที่:รับข้อมูลผู้ใช้ใหม่ ตรวจสอบความถูกต้องของชื่อ/รหัสผ่าน 
 *        เข้ารหัสผ่านด้วย bcrypt แล้วบันทึกลง Database
 */
router.post('/register', async (req, res) => {
    try {
        const { email, password, fullName, studentId, phone, userType, faculty, major } = req.body;

        // ตรวจสอบว่าส่งข้อมูลสำคัญมาครบหรือไม่
        if (!email || !password || !fullName) {
            return res.status(400).json({ success: false, message: 'กรุณากรอก Email, รหัสผ่าน และชื่อ-นามสกุล' });
        }

        // ใช้ Regular Expression ตรวจสอบว่าชื่อ-นามสกุลต้องเป็นภาษาไทยหรืออังกฤษเท่านั้น
        const nameRegex = /^[a-zA-Z\u0E00-\u0E7F\s]+$/;
        if (!nameRegex.test(fullName)) {
            return res.status(400).json({ success: false, message: 'ชื่อและนามสกุลต้องเป็นตัวอักษรไทยหรืออังกฤษเท่านั้น' });
        }

        // ใช้ Regular Expression บังคับความปลอดภัยรหัสผ่าน (8-16 ตัว มีพิมพ์เล็ก/ใหญ่/ตัวเลข)
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,16}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({ success: false, message: 'รหัสผ่านต้องมี 8-16 ตัว ประกอบด้วยตัวพิมพ์เล็ก, ตัวพิมพ์ใหญ่ และตัวเลขอย่างน้อยหนึ่งตัว' });
        }

        // ตรวจสอบในฐานข้อมูลว่าอีเมลนี้เคยสมัครหรือยัง
        const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'อีเมลนี้ถูกใช้งานแล้ว' });
        }

        // เข้ารหัสรหัสผ่าน (Hashing) ด้วย bcrypt จำนวน 10 รอบ
        const hashedPassword = await bcrypt.hash(password, 10);

        // นำข้อมูลบันทึกลงตาราง users ในฐานข้อมูล
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

/**
 * =========================================================================
 * 2. ฟังก์ชัน เข้าสู่ระบบ (Login)
 * =========================================================================
 * หน้าที่:รับ Email + Password ไปค้นหาใน Database ถ้าเจอ ให้เปรียบเทียบรหัส
 *        หากถูกต้อง จะสร้าง JWT Token ส่งกลับไปให้หน้าเว็บใช้เป็น "บัตรผ่าน"
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'กรุณากรอก Email และรหัสผ่าน' });
        }

        // ค้นหาผู้ใช้จาก email ในตาราง users
        const [users] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
        }

        const user = users[0];

        // ตรวจสอบว่าบัญชีถูกแบน (suspended) อยู่หรือไม่
        if (user.status === 'suspended') {
            return res.status(403).json({ success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน' });
        }

        // นำรหัสผ่านที่กรอกมา เปรียบเทียบกับรหัสที่ถูก Hash ไว้ใน Database
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
        }

        // สร้าง JWT Token ดึงข้อมูลสำคัญบางส่วนเข้าไปด้วย มีอายุ 24 ชั่วโมง
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            message: 'เข้าสู่ระบบสำเร็จ',
            token, // ตัว Token นี้แหละที่ส่งไปให้ฝั่ง Client (หน้าเว็บ) เก็บไว้ใช้งาน
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

// =========================================================================
// ตั้งค่าจุดบันทึกไฟล์ (Multer Storage) สำหรับอัปโหลดรูปโปรไฟล์
// =========================================================================
const profileUploadDir = path.join(__dirname, '../../frontend/uploads/profiles');
if (!fs.existsSync(profileUploadDir)) {
    fs.mkdirSync(profileUploadDir, { recursive: true });
}

const profileStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, profileUploadDir);
    },
    filename: function (req, file, cb) {
        // ตั้งชื่อไฟล์ตามเวลาปัจจุบันเพื่อไม่ให้ชื่อไฟล์ซ้ำกัน
        cb(null, 'profile-' + Date.now() + path.extname(file.originalname));
    }
});

const uploadProfile = multer({ storage: profileStorage });
const authenticateToken = require('../middleware/auth'); // เรียกใช้ตัวคัดกรอง Token

/**
 * =========================================================================
 * 3. ฟังก์ชัน อัปโหลดรูปโปรไฟล์
 * =========================================================================
 * หน้าที่:อัปโหลดไฟล์ภาพเข้าไปเก็บในโฟลเดอร์ และแก้ไขตารางผู้ใช้ อัปเดตที่อยู่ภาพ
 */
router.post('/profile-image', authenticateToken, uploadProfile.single('profileImage'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'กรุณาเลือกไฟล์รูปภาพ' });
        }

        const imageUrl = '/uploads/profiles/' + req.file.filename;
        // อัปเดตที่อยู่รูปภาพในตาราง users ตาม ID ของคนที่ทำการร้องขอ
        await db.execute('UPDATE users SET profile_image = ? WHERE id = ?', [imageUrl, req.user.userId]);

        res.json({ success: true, message: 'อัปเดตรูปโปรไฟล์สำเร็จ', imageUrl });
    } catch (error) {
        console.error('Upload profile image error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

/**
 * =========================================================================
 * 4. ฟังก์ชัน ดึงข้อมูลหน้าโปรไฟล์ผู้ใช้
 * =========================================================================
 * หน้าที่:(GET) จะส่งข้อมูลส่วนตัว พร้อมกับสรุปสถิติการใช้งาน เช่น จำนวนครั้งที่จองสำเร็จ/ยกเลิก
 */
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        // 1. ดึงข้อมูลพื้นฐานผู้ใช้จากตาราง users
        const [users] = await db.execute(
            'SELECT id, email, full_name, student_id, phone, faculty, major, user_type, role, created_at FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งาน' });
        }

        const user = users[0];

        // 2. ดึงและคำนวณสถิติการจองจากตาราง bookings
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
            stats: stats[0] // ส่งตัวเลขสถิติกลับไปด้วยเพื่อไปโชว์เป็นกรอบๆ ในหน้าเว็บ
        });

    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

/**
 * =========================================================================
 * 5. ฟังก์ชัน อัปเดตข้อมูลผู้ใช้ (แก้ไขโปรไฟล์)
 * =========================================================================
 * หน้าที่:(PUT) รับค่าที่แก้มาใหม่ และอัปเดตช่องนั้นๆ ในตาราง users
 */
router.put('/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { fullName, phone, faculty, major, email } = req.body;

        if (!fullName || fullName.trim() === '') {
            return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อ-นามสกุล' });
        }

        // ตรวจสอบว่าถ้าตั้งใจเปลี่ยนอีเมลใหม่ อีเมลนั้นห้ามซ้ำกับของเดิม/ของคนอื่น
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

        // ขอข้อมูลชุดใหม่กลับไปให้หน้าเว็บเพื่ออัปเดตให้แสดงเลยทันที
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

/**
 * =========================================================================
 * 6. ฟังก์ชัน ลืมรหัสผ่าน (Forgot Password)
 * =========================================================================
 * หน้าที่:สร้าง Token แบบสุ่มเพื่อส่งลิงก์จำเพาะไปทาง E-mail เพื่อให้ผู้ใช้สามารถคลิกเปลี่ยนรหัส
 */
router.post('/auth/forgot-password', async (req, res) => {
    const { email } = req.body;

    // การตอบกลับแบบปลอดภัย: แม้จะไม่มีอีเมลนี้อยู่จริง ก็จะตอบเหมือนกันว่า "ส่งให้แล้วถ้ามีในระบบ" 
    // เพื่อป้องกันผู้ไม่ประสงค์ดีทำการไล่สุ่มหาอีเมล (Prevent User Enumeration)
    const safeResponse = () => res.json({
        success: true,
        message: 'หากอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์กู้คืนรหัสผ่านไปให้คุณแล้ว กรุณาตรวจสอบกล่องจดหมายของคุณ'
    });

    try {
        if (!email) {
            return res.status(400).json({ success: false, message: 'กรุณากรอกอีเมล' });
        }

        const [users] = await db.execute('SELECT id, email, full_name FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return safeResponse();
        }

        const user = users[0];

        // ลบโทเค็นรีเซ็ตเก่าป้องกันการค้างสะสมใน Database
        await db.execute('DELETE FROM password_resets WHERE user_id = ?', [user.id]);

        // สร้างรหัสยาวสุ่ม (Token 32 Byte เป็นตัวอักษร)
        const plainToken = crypto.randomBytes(32).toString('hex');
        
        // เข้า Hash Token นี้อีกครั้งเพื่อความปลอดภัย เอาไปเก็บในตาราง password_resets
        const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // อายุไขลิงก์ = 30 นาที

        await db.execute(
            'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
            [user.id, hashedToken, expiresAt]
        );

        // สร้างลิงก์ที่จะแนบในเนื้อหาอีเมล (Plain token จะถูกส่งไปในลิงก์)
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const resetLink = `${baseUrl}/resetpass.html?token=${plainToken}`;

        // เตรียมตัวส่งอีเมลตามระบบ Mailer
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        // เนื้อหาอีเมลแจ้งเตือน
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

        if (process.env.EMAIL_USER && process.env.EMAIL_USER !== 'your_email@gmail.com') {
            try {
                await transporter.sendMail(mailOptions);
                console.log(`✅ Reset email sent to: ${user.email}`);
            } catch (emailError) {
                console.error('❌ Email send error:', emailError.message);
                console.log('🔗 [DEV] Reset link:', resetLink);
            }
        }

        return safeResponse();

    } catch (error) {
        console.error('Forgot password error:', error);
        return safeResponse();
    }
});

/**
 * =========================================================================
 * 7. ฟังก์ชัน ตรวจสอบ Token ก่อนรีเซ็ต (GET /reset-password)
 * =========================================================================
 * หน้าที่:ตรวจสอบว่า ลิงก์ที่อีเมลส่งมา หมดอายุหรือถูกใช้ไปแล้วหรือยัง
 */
router.get('/auth/reset-password', async (req, res) => {
    try {
        const { token } = req.query;

        if (!token) return res.json({ valid: false, message: 'ไม่พบ token' });

        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const [rows] = await db.execute('SELECT * FROM password_resets WHERE token = ?', [hashedToken]);

        if (rows.length === 0) return res.json({ valid: false, message: 'ลิงก์นี้ไม่ถูกต้องหรือหมดอายุแล้ว' });

        const resetRecord = rows[0];

        if (resetRecord.used) return res.json({ valid: false, message: 'ลิงก์นี้ถูกใช้งานแล้ว กรุณาขอลิงก์ใหม่' });
        if (new Date() > new Date(resetRecord.expires_at)) return res.json({ valid: false, message: 'ลิงก์นี้หมดอายุแล้ว กรุณาขอลิงก์ใหม่' });

        res.json({ valid: true });

    } catch (error) {
        console.error('Verify token error:', error);
        res.json({ valid: false, message: 'เกิดข้อผิดพลาดในการตรวจสอบ token' });
    }
});

/**
 * =========================================================================
 * 8. ฟังก์ชัน เปลี่ยนรหัสผ่านใหม่ (POST /reset-password)
 * =========================================================================
 * หน้าที่:รับรหัสผ่านที่ตั้งใหม่มารหัสผ่าน และทำการบันทึกทับรหัสเก่า พร้อมกับยกเลิก Token ทิ้ง
 */
router.post('/auth/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });

        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,16}$/;
        if (!passwordRegex.test(newPassword)) {
            return res.status(400).json({
                success: false,
                message: 'รหัสผ่านต้องมี 8-16 ตัว ประกอบด้วยตัวพิมพ์เล็ก, ตัวพิมพ์ใหญ่ และตัวเลขอย่างน้อยหนึ่งตัว'
            });
        }

        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const [rows] = await db.execute(
            'SELECT pr.*, u.email, u.full_name FROM password_resets pr JOIN users u ON pr.user_id = u.id WHERE pr.token = ?',
            [hashedToken]
        );

        if (rows.length === 0) return res.status(400).json({ success: false, message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว' });

        const resetRecord = rows[0];

        if (resetRecord.used) return res.status(400).json({ success: false, message: 'ลิงก์นี้ถูกใช้งานแล้ว กรุณาขอลิงก์ใหม่' });
        if (new Date() > new Date(resetRecord.expires_at)) return res.status(400).json({ success: false, message: 'ลิงก์นี้หมดอายุแล้ว กรุณาขอลิงก์ใหม่' });

        // นำรหัสผ่านใหม่ไป Hash 
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // นำรหัสเซฟทับตัวเก่า
        await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, resetRecord.user_id]);
        
        // กาหัวว่า Token นี้ถูกใช้แล้ว (used = 1) เพื่อป้องกันการกดลิงก์เดิมอีกครั้ง
        await db.execute('UPDATE password_resets SET used = 1 WHERE id = ?', [resetRecord.id]);

        res.json({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่' });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

/**
 * =========================================================================
 * 9. ฟังก์ชัน ข้อมูลสถิติ (Stats - ไม่ต้องการ Login)
 * =========================================================================
 * หน้าที่:ดึงข้อมูลตัวเลขรวม เช่น จำนวนสนามกีฬาที่มี อุปกรณ์ที่มี ไปแสดงเป็นตัวเลขสรุปหน้าแรก
 */
router.get('/stats', async (req, res) => {
    try {
        const [[{ totalCourts }]] = await db.execute("SELECT COUNT(*) as totalCourts FROM courts WHERE status != 'maintenance'");
        const [[{ totalEquipment }]] = await db.execute("SELECT COUNT(*) as totalEquipment FROM equipment");
        const [[{ totalUsers }]] = await db.execute("SELECT COUNT(*) as totalUsers FROM users WHERE role != 'admin'");

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
