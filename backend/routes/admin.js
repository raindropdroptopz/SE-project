const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');

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

        // นับจำนวนการยืมอุปกรณ์ที่รออนุมัติ
        const [pendingEquipmentBookings] = await db.execute(
            "SELECT COUNT(*) as count FROM equipment_bookings WHERE status = 'pending'"
        );

        // การจองล่าสุด 10 รายการ
        const [recentBookings] = await db.execute(`
            SELECT b.*, c.name as court_name, u.full_name as user_name,
                   p.payment_slip, p.total_amount, p.status as payment_status
            FROM bookings b
            JOIN courts c ON b.court_id = c.id
            JOIN users u ON b.user_id = u.id
            LEFT JOIN payments p ON b.id = p.booking_id
            ORDER BY b.created_at DESC
            LIMIT 10
        `);

        res.json({
            success: true,
            stats: {
                totalUsers: users[0].count,
                todayBookings: todayBookings[0].count,
                pendingBookings: pendingBookings[0].count,
                pendingEquipmentBookings: pendingEquipmentBookings[0].count,
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
// GET /api/admin/users/stats - สถิติผู้ใช้งาน
// ===============================================
router.get('/users/stats', authenticateAdmin, async (req, res) => {
    try {
        const [[{ total }]] = await db.execute('SELECT COUNT(*) as total FROM users');
        const [[{ student }]] = await db.execute("SELECT COUNT(*) as student FROM users WHERE user_type = 'student'");
        const [[{ staff }]] = await db.execute("SELECT COUNT(*) as staff FROM users WHERE user_type = 'staff'");
        const [[{ external }]] = await db.execute("SELECT COUNT(*) as external FROM users WHERE user_type = 'external'");

        res.json({
            success: true,
            stats: {
                total: total || 0,
                student: student || 0,
                staff: staff || 0,
                external: external || 0
            }
        });
    } catch (error) {
        console.error('Get user stats error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// GET /api/admin/users - รายการผู้ใช้ทั้งหมด พร้อมกรองข้อมูล
// ===============================================
router.get('/users', authenticateAdmin, async (req, res) => {
    try {
        const { search, type, status } = req.query;
        let query = `
            SELECT 
                u.id, u.email, u.full_name, u.student_id, u.phone, u.user_type, u.role, u.status, u.created_at,
                COUNT(b.id) as total_bookings
            FROM users u
            LEFT JOIN bookings b ON u.id = b.user_id
            WHERE 1=1
        `;
        const queryParams = [];

        if (search) {
            query += ` AND (u.full_name LIKE ? OR u.email LIKE ? OR u.student_id LIKE ?)`;
            const searchPattern = `%${search}%`;
            queryParams.push(searchPattern, searchPattern, searchPattern);
        }

        if (type) {
            query += ` AND u.user_type = ?`;
            queryParams.push(type);
        }

        if (status) {
            query += ` AND u.status = ?`;
            queryParams.push(status);
        }

        query += ` GROUP BY u.id ORDER BY u.created_at DESC`;

        const [users] = await db.execute(query, queryParams);
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
            SELECT b.id, b.booking_date, b.start_time, b.end_time, b.status, 
                   c.name as court_name, u.full_name as user_name, u.email as user_email, u.student_id,
                   p.total_amount as price, p.payment_slip, 'court' as type
            FROM bookings b
            JOIN courts c ON b.court_id = c.id
            JOIN users u ON b.user_id = u.id
            LEFT JOIN payments p ON b.id = p.booking_id
            
            UNION ALL
            
            SELECT eb.id, eb.borrow_date as booking_date, '08:00:00' as start_time, '20:00:00' as end_time, eb.status,
                   CONCAT('ยืม: ', e.name, ' (x', eb.quantity, ')') as court_name, u.full_name as user_name, u.email as user_email, u.student_id,
                   (eb.quantity * e.price) as price, NULL as payment_slip, 'equipment' as type
            FROM equipment_bookings eb
            JOIN equipment e ON eb.equipment_id = e.id
            JOIN users u ON eb.user_id = u.id
            
            ORDER BY booking_date DESC, start_time ASC
        `);

        res.json({ success: true, bookings });

    } catch (error) {
        console.error('Get all bookings error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// PUT /api/admin/bookings/:id/status - อัปเดตสถานะการจอง (สนามหรืออุปกรณ์)
// ===============================================
router.put('/bookings/:id/status', authenticateAdmin, async (req, res) => {
    try {
        const { status, type } = req.body;
        const targetTable = type === 'equipment' ? 'equipment_bookings' : 'bookings';

        await db.execute(
            `UPDATE ${targetTable} SET status = ? WHERE id = ?`,
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
// GET /api/admin/finance - ข้อมูลรายรับรายจ่าย จาก payments table
// ===============================================
router.get('/finance', authenticateAdmin, async (req, res) => {
    try {
        const { type, startDate, endDate } = req.query;

        // Build date filter for court bookings (booking_date)
        let courtDateCondition = '';
        const courtParams = [];
        if (startDate && endDate) {
            courtDateCondition = 'AND b.booking_date >= ? AND b.booking_date <= ?';
            courtParams.push(startDate, endDate);
        } else if (startDate) {
            courtDateCondition = 'AND b.booking_date >= ?';
            courtParams.push(startDate);
        } else if (endDate) {
            courtDateCondition = 'AND b.booking_date <= ?';
            courtParams.push(endDate);
        }

        // Build date filter for equipment bookings (borrow_date)
        let equipDateCondition = '';
        const equipParams = [];
        if (startDate && endDate) {
            equipDateCondition = 'AND eb.borrow_date >= ? AND eb.borrow_date <= ?';
            equipParams.push(startDate, endDate);
        } else if (startDate) {
            equipDateCondition = 'AND eb.borrow_date >= ?';
            equipParams.push(startDate);
        } else if (endDate) {
            equipDateCondition = 'AND eb.borrow_date <= ?';
            equipParams.push(endDate);
        }

        // Calculate totals from both sources
        // 1. Court Bookings (from payments table)
        const [courtIncomeResult] = await db.execute(`
            SELECT IFNULL(SUM(p.total_amount), 0) as total_income
            FROM payments p
            JOIN bookings b ON p.booking_id = b.id
            WHERE p.status IN ('pending','verified') ${courtDateCondition}
        `, courtParams);

        // 2. Standalone Equipment Bookings (those without booking_id in any payment)
        // Note: Currently equipment rentals don't have a direct payment record, 
        // they are stored in equipment_bookings. If they have a price, we count it.
        const [equipIncomeResult] = await db.execute(`
            SELECT IFNULL(SUM(eb.quantity * e.price), 0) as total_income
            FROM equipment_bookings eb
            JOIN equipment e ON eb.equipment_id = e.id
            WHERE eb.status != 'cancelled' ${equipDateCondition}
        `, equipParams);

        const totalIncome = parseInt(courtIncomeResult[0].total_income) + parseInt(equipIncomeResult[0].total_income);
        const totalExpense = 0;
        const balance = totalIncome - totalExpense;

        // Fetch transaction list (Combined)
        const [transactions] = await db.execute(`
            SELECT * FROM (
                -- Court + Integrated Equipment Payments
                SELECT
                    CONCAT('P', p.id) as id,
                    DATE_FORMAT(b.booking_date, '%Y-%m-%d') as date,
                    CONCAT('ค่าจอง', c.name, ' #BK', LPAD(b.id, 4, '0')) as description,
                    'รายรับ' as type,
                    p.total_amount as amount,
                    CONCAT(u.full_name, ' | สนาม ฿', p.court_subtotal, ' อุปกรณ์ ฿', p.equipment_subtotal) as note,
                    p.status as payment_status,
                    p.payment_slip
                FROM payments p
                JOIN bookings b ON p.booking_id = b.id
                JOIN courts c ON b.court_id = c.id
                JOIN users u ON p.user_id = u.id
                WHERE 1=1 ${courtDateCondition.replace('b.', 'b.')}

                UNION ALL

                -- Standalone Equipment Bookings
                SELECT
                    CONCAT('EB', eb.id) as id,
                    DATE_FORMAT(eb.borrow_date, '%Y-%m-%d') as date,
                    CONCAT('ยืมอุปกรณ์: ', e.name, ' (x', eb.quantity, ')') as description,
                    'รายรับ' as type,
                    (eb.quantity * e.price) as amount,
                    CONCAT(u.full_name, ' | ยืมอุปกรณ์ standalone') as note,
                    eb.status as payment_status,
                    NULL as payment_slip
                FROM equipment_bookings eb
                JOIN equipment e ON eb.equipment_id = e.id
                JOIN users u ON eb.user_id = u.id
                WHERE eb.status != 'cancelled' ${equipDateCondition.replace('eb.', 'eb.')}
            ) as combined
            ORDER BY date DESC, id DESC
        `, [...courtParams, ...equipParams]);

        const filteredTransactions = type === 'รายจ่าย' ? [] :
            (type === 'รายรับ' ? transactions : transactions);

        res.json({
            success: true,
            summary: { totalIncome, totalExpense, balance },
            transactions: filteredTransactions
        });

    } catch (error) {
        console.error('Get finance error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// PATCH /api/admin/payments/:id/status - ยืนยัน/ปฏิเสธสลิปชำระเงิน
// ===============================================
router.patch('/payments/:id/status', authenticateAdmin, async (req, res) => {
    try {
        let paymentId = req.params.id;
        const { status } = req.body; // 'verified' or 'rejected'
        
        // Remove 'P' prefix if sent from finance page
        if (typeof paymentId === 'string' && paymentId.startsWith('P')) {
            paymentId = paymentId.substring(1);
        }

        if (!['verified', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'สถานะไม่ถูกต้อง' });
        }

        // Update payment status
        await db.execute('UPDATE payments SET status = ? WHERE id = ?', [status, paymentId]);

        // If verified → confirm the booking too
        if (status === 'verified') {
            const [rows] = await db.execute('SELECT booking_id FROM payments WHERE id = ?', [paymentId]);
            if (rows.length > 0) {
                await db.execute("UPDATE bookings SET status = 'confirmed' WHERE id = ?", [rows[0].booking_id]);
            }
        }

        res.json({ success: true, message: status === 'verified' ? 'ยืนยันสลิปสำเร็จ' : 'ปฏิเสธสลิปสำเร็จ' });

    } catch (error) {
        console.error('Update payment status error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});


// ===============================================
// GET /api/admin/receipts - ดึงข้อมูลใบเสร็จรับเงิน
// ===============================================
router.get('/receipts', authenticateAdmin, async (req, res) => {
    try {
        const { search, date } = req.query;

        // Query 1: FROM BOOKINGS
        let bookingQuery = `
            SELECT 
                CONCAT('RC', YEAR(b.created_at), '-', LPAD(b.id, 4, '0')) as receipt_id,
                u.full_name as user_name,
                u.student_id,
                CONCAT('ค่าจอง', c.name) as item_name,
                ((HOUR(b.end_time) - HOUR(b.start_time)) * c.price) as amount,
                b.created_at as receipt_date,
                (HOUR(b.end_time) - HOUR(b.start_time)) as hours_booked
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            JOIN courts c ON b.court_id = c.id
            WHERE (b.status = 'confirmed' OR b.status = 'completed')
        `;

        // Query 2: FROM MANUAL RECEIPTS
        // Creating table inside the query execution (or beforehand) using raw SQL check
        await db.execute(`
            CREATE TABLE IF NOT EXISTS manual_receipts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_name VARCHAR(255) NOT NULL,
                student_id VARCHAR(20),
                phone VARCHAR(20),
                item_name VARCHAR(255) NOT NULL,
                amount INT NOT NULL,
                receipt_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        let manualQuery = `
            SELECT 
                CONCAT('MN', YEAR(m.receipt_date), '-', LPAD(m.id, 4, '0')) COLLATE utf8mb4_unicode_ci as receipt_id,
                m.user_name COLLATE utf8mb4_unicode_ci as user_name,
                m.student_id COLLATE utf8mb4_unicode_ci as student_id,
                m.item_name COLLATE utf8mb4_unicode_ci as item_name,
                m.amount,
                m.receipt_date,
                0 as hours_booked
            FROM manual_receipts m
            WHERE 1=1
        `;

        let bookingParams = [];
        let manualParams = [];

        if (search) {
            const searchParam = `%${search}%`;
            bookingQuery += ` AND (u.full_name COLLATE utf8mb4_unicode_ci LIKE ? OR u.student_id COLLATE utf8mb4_unicode_ci LIKE ? OR CONCAT('RC', YEAR(b.created_at), '-', LPAD(b.id, 4, '0')) COLLATE utf8mb4_unicode_ci LIKE ?)`;
            manualQuery += ` AND (m.user_name COLLATE utf8mb4_unicode_ci LIKE ? OR m.student_id COLLATE utf8mb4_unicode_ci LIKE ? OR CONCAT('MN', YEAR(m.receipt_date), '-', LPAD(m.id, 4, '0')) COLLATE utf8mb4_unicode_ci LIKE ?)`;
            bookingParams.push(searchParam, searchParam, searchParam);
            manualParams.push(searchParam, searchParam, searchParam);
        }

        if (date) {
            bookingQuery += ` AND DATE(b.created_at) = ?`;
            manualQuery += ` AND DATE(m.receipt_date) = ?`;
            bookingParams.push(date);
            manualParams.push(date);
        }

        const finalQuery = `
            SELECT * FROM (${bookingQuery}) AS bqs 
            UNION ALL 
            SELECT * FROM (${manualQuery}) AS mqs
            ORDER BY receipt_date DESC
            LIMIT 100
        `;

        const queryParams = [...bookingParams, ...manualParams];

        const [receipts] = await db.execute(finalQuery, queryParams);

        res.json({ success: true, receipts });

    } catch (error) {
        console.error('Get receipts error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// POST /api/admin/receipts/manual - สร้างใบเสร็จด้วยตนเอง
// ===============================================
router.post('/receipts/manual', authenticateAdmin, async (req, res) => {
    try {
        const { user_name, student_id, phone, item_name, amount } = req.body;

        if (!user_name || !item_name || amount === undefined) {
            return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลที่จำเป็น (ชื่อ, รายการ, จำนวนเงิน)' });
        }

        // Ensure table exists
        await db.execute(`
            CREATE TABLE IF NOT EXISTS manual_receipts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_name VARCHAR(255) NOT NULL,
                student_id VARCHAR(20),
                phone VARCHAR(20),
                item_name VARCHAR(255) NOT NULL,
                amount INT NOT NULL,
                receipt_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const [result] = await db.execute(`
            INSERT INTO manual_receipts (user_name, student_id, phone, item_name, amount)
            VALUES (?, ?, ?, ?, ?)
        `, [user_name, student_id || null, phone || null, item_name, amount]);

        res.status(201).json({
            success: true,
            message: 'สร้างใบเสร็จสำเร็จ',
            receiptId: result.insertId
        });

    } catch (error) {
        console.error('Manual receipt error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการสร้างใบเสร็จ' });
    }
});

// ===============================================
// GET /api/admin/equipment-borrows - รายงานการยืม-คืนอุปกรณ์
// ===============================================
router.get('/equipment-borrows', authenticateAdmin, async (req, res) => {
    try {
        const { search, equipment, status, date } = req.query;

        // 1. Calculate Stats
        const [[{ total }]] = await db.execute('SELECT COUNT(*) as total FROM equipment_bookings');
        const [[{ borrowed }]] = await db.execute(`SELECT COUNT(*) as borrowed FROM equipment_bookings WHERE status IN ('pending', 'borrowed')`);
        const [[{ returned }]] = await db.execute(`SELECT COUNT(*) as returned FROM equipment_bookings WHERE status = 'returned'`);
        const [[{ overdue }]] = await db.execute(`SELECT COUNT(*) as overdue FROM equipment_bookings WHERE status = 'overdue'`);

        // 2. Build Query for Data
        let query = `
            SELECT 
                eb.id as borrow_id,
                CONCAT('BR', LPAD(eb.id, 4, '0')) as borrow_ref,
                u.full_name as user_name,
                u.student_id,
                e.name as equipment_name,
                eb.quantity,
                eb.borrow_date,
                eb.return_date,
                eb.status
            FROM equipment_bookings eb
            JOIN users u ON eb.user_id = u.id
            JOIN equipment e ON eb.equipment_id = e.id
            WHERE 1=1
        `;
        const queryParams = [];

        if (search) {
            query += ` AND (CONCAT('BR', LPAD(eb.id, 4, '0')) LIKE ? 
                        OR u.full_name LIKE ? 
                        OR u.student_id LIKE ?)`;
            const searchPattern = `%${search}%`;
            queryParams.push(searchPattern, searchPattern, searchPattern);
        }

        if (equipment) {
            query += ` AND e.name = ?`;
            queryParams.push(equipment);
        }

        if (status) {
            if (status === 'กำลังยืม') {
                query += ` AND eb.status IN ('pending', 'borrowed')`;
            } else if (status === 'คืนแล้ว') {
                query += ` AND eb.status = 'returned'`;
            } else if (status === 'เกินกำหนด') {
                query += ` AND eb.status = 'overdue'`;
            }
        }

        if (date) {
            query += ` AND eb.borrow_date = ?`;
            queryParams.push(date);
        }

        query += ` ORDER BY eb.borrow_date DESC, eb.id DESC`;

        const [borrows] = await db.execute(query, queryParams);

        res.json({
            success: true,
            stats: {
                total: total || 0,
                borrowed: borrowed || 0,
                returned: returned || 0,
                overdue: overdue || 0
            },
            borrows
        });

    } catch (error) {
        console.error('Get equipment borrows error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการโหลดรายงานการยืม' });
    }
});

// ===============================================
// PUT /api/admin/equipment-borrows/:id/return - รับคืนอุปกรณ์
// ===============================================
router.put('/equipment-borrows/:id/return', authenticateAdmin, async (req, res) => {
    try {
        const borrowId = req.params.id;

        // ค้นหารายการยืม
        const [borrows] = await db.execute(
            "SELECT * FROM equipment_bookings WHERE id = ?",
            [borrowId]
        );

        if (borrows.length === 0) {
            return res.status(404).json({ success: false, message: "ไม่พบรายการยืม" });
        }

        const borrow = borrows[0];

        if (borrow.status === 'returned') {
            return res.status(400).json({ success: false, message: "รายการนี้ถูกรับคืนไปแล้ว" });
        }

        // อัปเดตสถานะการยืม
        await db.execute(
            "UPDATE equipment_bookings SET status = ?, actual_return_date = CURDATE() WHERE id = ?",
            ["returned", borrowId]
        );

        // อัปเดตจำนวนอุปกรณ์
        const [equipment] = await db.execute(
            "SELECT * FROM equipment WHERE id = ?",
            [borrow.equipment_id]
        );

        if (equipment.length > 0) {
            const item = equipment[0];
            const newAvailable = item.available + borrow.quantity;
            let newStatus = "available";
            if (newAvailable <= 2) newStatus = "low";

            await db.execute(
                "UPDATE equipment SET available = ?, status = ? WHERE id = ?",
                [newAvailable, newStatus, borrow.equipment_id]
            );
        }

        res.json({ success: true, message: "รับคืนอุปกรณ์สำเร็จ" });

    } catch (error) {
        console.error("Return equipment error:", error);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการรับคืนอุปกรณ์" });
    }
});

// ===============================================
// POST /api/admin/equipment - เพิ่มอุปกรณ์ใหม่
// ===============================================
router.post('/equipment', authenticateAdmin, async (req, res) => {
    try {
        const { name, description, category, stock, image_url } = req.body;

        if (!name || stock === undefined) {
            return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
        }

        const parsedStock = parseInt(stock, 10);
        const STATUS = parsedStock > 2 ? 'available' : (parsedStock > 0 ? 'low' : 'out');

        const [result] = await db.execute(`
            INSERT INTO equipment (name, description, category, stock, available, status, image_url)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            name,
            description || '',
            category || 'อื่นๆ',
            parsedStock,
            parsedStock,
            STATUS,
            image_url || '/photo/default.jpg'
        ]);

        res.status(201).json({ success: true, message: 'เพิ่มอุปกรณ์สำเร็จ', id: result.insertId });

    } catch (error) {
        console.error('Add equipment error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการเพิ่มอุปกรณ์' });
    }
});

// ===============================================
// PUT /api/admin/equipment/:id - แก้ไขอุปกรณ์
// ===============================================
router.put('/equipment/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, category, stock, image_url } = req.body;

        if (!name || stock === undefined) {
            return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
        }

        // Fetch current to calculate new available
        const [currentEq] = await db.execute('SELECT stock, available FROM equipment WHERE id = ?', [id]);
        if (currentEq.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบอุปกรณ์' });
        }

        const oldStock = currentEq[0].stock;
        const oldAvailable = currentEq[0].available;
        const parsedStock = parseInt(stock, 10);

        // New available = Old Available + (New Stock - Old Stock)
        let newAvailable = oldAvailable + (parsedStock - oldStock);
        if (newAvailable < 0) newAvailable = 0; // Prevent negative if they decrease stock below borrowed amount

        const STATUS = newAvailable > 2 ? 'available' : (newAvailable > 0 ? 'low' : 'out');

        await db.execute(`
            UPDATE equipment 
            SET name = ?, description = ?, category = ?, stock = ?, available = ?, status = ?, image_url = ?
            WHERE id = ?
        `, [
            name,
            description || '',
            category || 'อื่นๆ',
            parsedStock,
            newAvailable,
            STATUS,
            image_url || '/photo/default.jpg',
            id
        ]);

        res.json({ success: true, message: 'อัปเดตอุปกรณ์สำเร็จ' });

    } catch (error) {
        console.error('Update equipment error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการแก้ไขอุปกรณ์' });
    }
});

// ===============================================
// DELETE /api/admin/equipment/:id - ลบอุปกรณ์
// ===============================================
router.delete('/equipment/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await db.execute('DELETE FROM equipment WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบอุปกรณ์ที่ต้องการลบ' });
        }

        res.json({ success: true, message: 'ลบอุปกรณ์สำเร็จ' });

    } catch (error) {
        console.error('Delete equipment error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการลบอุปกรณ์' });
    }
});

// ===============================================
// POST /api/admin/users - เพิ่มผู้ใช้ใหม่
// ===============================================
router.post('/users', authenticateAdmin, async (req, res) => {
    try {
        const { email, password, full_name, student_id, phone, user_type, role, status } = req.body;

        if (!email || !password || !full_name || !user_type || !role) {
            return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน' });
        }

        // Check if email or student ID already exists
        const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'อีเมลนี้ถูกใช้งานแล้ว' });
        }

        if (student_id) {
            const [existingStudentId] = await db.execute('SELECT id FROM users WHERE student_id = ?', [student_id]);
            if (existingStudentId.length > 0) {
                return res.status(400).json({ success: false, message: 'รหัสนักศึกษานี้ถูกใช้งานแล้ว' });
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await db.execute(`
            INSERT INTO users (email, password, full_name, student_id, phone, user_type, role, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            email,
            hashedPassword,
            full_name,
            student_id || null,
            phone || null,
            user_type,
            role,
            status || 'active'
        ]);

        res.status(201).json({ success: true, message: 'เพิ่มผู้ใช้สำเร็จ', id: result.insertId });

    } catch (error) {
        console.error('Add user error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการเพิ่มผู้ใช้' });
    }
});

// ===============================================
// PUT /api/admin/users/:id - แก้ไขผู้ใช้
// ===============================================
router.put('/users/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { email, password, full_name, student_id, phone, user_type, role, status } = req.body;

        if (!email || !full_name || !user_type || !role) {
            return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน' });
        }

        // Only checking if changing email conflicts with ANOTHER user
        const [existing] = await db.execute('SELECT id FROM users WHERE email = ? AND id != ?', [email, id]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'อีเมลนี้ถูกใช้งานแล้ว' });
        }

        let query = `
            UPDATE users 
            SET email = ?, full_name = ?, student_id = ?, phone = ?, user_type = ?, role = ?, status = ?
        `;
        let params = [email, full_name, student_id || null, phone || null, user_type, role, status || 'active'];

        if (password && password.trim() !== '') {
            const hashedPassword = await bcrypt.hash(password, 10);
            query += `, password = ?`;
            params.push(hashedPassword);
        }

        query += ` WHERE id = ?`;
        params.push(id);

        const [result] = await db.execute(query, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้ที่ต้องการแก้ไข' });
        }

        res.json({ success: true, message: 'อัปเดตผู้ใช้สำเร็จ' });

    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการแก้ไขผู้ใช้' });
    }
});

module.exports = router;
