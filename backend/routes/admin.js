const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../config/database');

// Middleware ตรวจสอบ Admin
const authenticateAdmin = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' });
        }

        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Token ไม่ถูกต้อง' });
    }
};

// ===============================================
// GET /api/admin/dashboard - ข้อมูล Dashboard
// ===============================================
router.get('/dashboard', authenticateAdmin, async (req, res) => {
    try {
        // นับจำนวนผู้ใช้
        const [users] = await db.execute('SELECT COUNT(*) as count FROM users');

        // นับจำนวนการจองวันนี้
        const [todayBookings] = await db.execute(
            'SELECT COUNT(*) as count FROM bookings WHERE booking_date = CURDATE()'
        );

        // นับจำนวนการจองที่รออนุมัติ
        const [pendingBookings] = await db.execute(
            "SELECT COUNT(*) as count FROM bookings WHERE status = 'pending'"
        );

        // นับจำนวนการจองทั้งหมด
        const [totalBookings] = await db.execute('SELECT COUNT(*) as count FROM bookings');

        // นับจำนวนอุปกรณ์ที่ถูกยืม
        const [borrowedEquipment] = await db.execute(
            "SELECT COUNT(*) as count FROM equipment_bookings WHERE status = 'borrowed'"
        );

        // การจองล่าสุด 10 รายการ
        const [recentBookings] = await db.execute(`
            SELECT b.*, c.name as court_name, u.full_name as user_name
            FROM bookings b
            JOIN courts c ON b.court_id = c.id
            JOIN users u ON b.user_id = u.id
            ORDER BY b.created_at DESC
            LIMIT 10
        `);

        res.json({
            success: true,
            stats: {
                totalUsers: users[0].count,
                todayBookings: todayBookings[0].count,
                pendingBookings: pendingBookings[0].count,
                totalBookings: totalBookings[0].count,
                borrowedEquipment: borrowedEquipment[0].count
            },
            recentBookings
        });

    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// GET /api/admin/users - รายการผู้ใช้ทั้งหมด
// ===============================================
router.get('/users', authenticateAdmin, async (req, res) => {
    try {
        const [users] = await db.execute(`
            SELECT id, email, full_name, student_id, phone, user_type, role, created_at
            FROM users
            ORDER BY created_at DESC
        `);

        res.json({ success: true, users });

    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// DELETE /api/admin/users/:id - ลบผู้ใช้
// ===============================================
router.delete('/users/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.execute('DELETE FROM users WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'ลบผู้ใช้สำเร็จ' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// GET /api/admin/bookings - รายการจองทั้งหมด
// ===============================================
router.get('/bookings', authenticateAdmin, async (req, res) => {
    try {
        const [bookings] = await db.execute(`
            SELECT b.*, c.name as court_name, u.full_name as user_name, u.email as user_email
            FROM bookings b
            JOIN courts c ON b.court_id = c.id
            JOIN users u ON b.user_id = u.id
            ORDER BY b.booking_date DESC, b.start_time ASC
        `);

        res.json({ success: true, bookings });

    } catch (error) {
        console.error('Get all bookings error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// PUT /api/admin/bookings/:id/status - อัปเดตสถานะการจอง
// ===============================================
router.put('/bookings/:id/status', authenticateAdmin, async (req, res) => {
    try {
        const { status } = req.body;

        await db.execute(
            'UPDATE bookings SET status = ? WHERE id = ?',
            [status, req.params.id]
        );

        res.json({ success: true, message: 'อัปเดตสถานะสำเร็จ' });

    } catch (error) {
        console.error('Update booking status error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// DELETE /api/admin/bookings/:id - ลบการจอง
// ===============================================
router.delete('/bookings/:id', authenticateAdmin, async (req, res) => {
    try {
        const bookingId = req.params.id;

        // ตรวจสอบว่ามีการจองนี้อยู่หรือไม่
        const [bookings] = await db.execute('SELECT * FROM bookings WHERE id = ?', [bookingId]);
        if (bookings.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบการจอง' });
        }

        // ลบการจอง
        await db.execute('DELETE FROM bookings WHERE id = ?', [bookingId]);

        res.json({ success: true, message: 'ลบการจองสำเร็จ' });

    } catch (error) {
        console.error('Delete booking error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// GET /api/admin/equipment - รายการอุปกรณ์ทั้งหมด
// ===============================================
router.get('/equipment', authenticateAdmin, async (req, res) => {
    try {
        const [equipment] = await db.execute('SELECT * FROM equipment ORDER BY category, name');
        res.json({ success: true, equipment });
    } catch (error) {
        console.error('Get equipment error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// PUT /api/admin/equipment/:id - อัปเดตอุปกรณ์
// ===============================================
router.put('/equipment/:id', authenticateAdmin, async (req, res) => {
    try {
        const { name, description, category, stock, available, status } = req.body;

        await db.execute(`
            UPDATE equipment 
            SET name = ?, description = ?, category = ?, stock = ?, available = ?, status = ?
            WHERE id = ?
        `, [name, description, category, stock, available, status, req.params.id]);

        res.json({ success: true, message: 'อัปเดตอุปกรณ์สำเร็จ' });

    } catch (error) {
        console.error('Update equipment error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// POST /api/admin/equipment - เพิ่มอุปกรณ์ใหม่
// ===============================================
router.post('/equipment', authenticateAdmin, async (req, res) => {
    try {
        const { name, description, category, stock, image_url } = req.body;

        const [result] = await db.execute(`
            INSERT INTO equipment (name, description, category, stock, available, image_url, status)
            VALUES (?, ?, ?, ?, ?, ?, 'available')
        `, [name, description, category, stock, stock, image_url]);

        res.status(201).json({
            success: true,
            message: 'เพิ่มอุปกรณ์สำเร็จ',
            equipmentId: result.insertId
        });

    } catch (error) {
        console.error('Add equipment error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// GET /api/admin/courts - ดึงรายการสนามทั้งหมด
// ===============================================
router.get('/courts', authenticateAdmin, async (req, res) => {
    try {
        const [courts] = await db.execute('SELECT * FROM courts ORDER BY id ASC');
        res.json({ success: true, courts });
    } catch (error) {
        console.error('Get admin courts error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// PUT /api/admin/courts/:id - อัปเดตข้อมูลสนาม
// ===============================================
router.put('/courts/:id', authenticateAdmin, async (req, res) => {
    try {
        const { name, description, capacity, open_time, close_time, price, status } = req.body;

        if (price !== undefined && price < 0) {
            return res.status(400).json({ success: false, message: 'ราคาไม่สามารถติดลบได้' });
        }

        await db.execute(`
            UPDATE courts 
            SET name = ?, description = ?, capacity = ?, open_time = ?, close_time = ?, price = ?, status = ?
            WHERE id = ?
        `, [name, description, capacity, open_time, close_time, price, status, req.params.id]);

        res.json({ success: true, message: 'อัปเดตข้อมูลสนามสำเร็จ' });

    } catch (error) {
        console.error('Update court error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// DELETE /api/admin/courts/:id - ลบสนามกีฬา
// ===============================================
router.delete('/courts/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.execute('DELETE FROM courts WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'ลบสนามกีฬาสำเร็จ' });
    } catch (error) {
        console.error('Delete court error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// POST /api/admin/courts - เพิ่มสนามกีฬาใหม่
// ===============================================
router.post('/courts', authenticateAdmin, async (req, res) => {
    try {
        const { name, description, capacity, open_time, close_time, price, image_url, status } = req.body;

        if (price !== undefined && price < 0) {
            return res.status(400).json({ success: false, message: 'ราคาไม่สามารถติดลบได้' });
        }

        const [result] = await db.execute(`
            INSERT INTO courts (name, description, capacity, open_time, close_time, price, image_url, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [name, description, capacity || 10, open_time || '06:00:00', close_time || '20:00:00', price || 300, image_url, status || 'available']);

        res.status(201).json({
            success: true,
            message: 'เพิ่มสนามสำเร็จ',
            courtId: result.insertId
        });

    } catch (error) {
        console.error('Add court error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// POST /api/admin/users - เพิ่มผู้ใช้ใหม่
// ===============================================
router.post('/users', authenticateAdmin, async (req, res) => {
    try {
        const { email, password, fullName, studentId, phone, userType, role } = req.body;

        // ตรวจสอบว่ามี email นี้อยู่แล้วหรือไม่
        const [existingUsers] = await db.execute(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({ success: false, message: 'อีเมลนี้ถูกใช้งานแล้ว' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await db.execute(`
            INSERT INTO users (email, password, full_name, student_id, phone, user_type, role) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [email, hashedPassword, fullName, studentId || null, phone || null, userType || 'student', role || 'user']);

        res.status(201).json({
            success: true,
            message: 'เพิ่มผู้ใช้สำเร็จ',
            userId: result.insertId
        });

    } catch (error) {
        console.error('Add user error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

module.exports = router;
