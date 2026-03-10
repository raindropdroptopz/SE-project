const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../config/database');

// Middleware ตรวจสอบ Token
const authenticateToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Token ไม่ถูกต้อง' });
    }
};

// ===============================================
// GET /api/equipment - ดึงรายการอุปกรณ์ทั้งหมด (พร้อมค้นหา/กรอง)
// ===============================================
router.get('/', async (req, res) => {
    try {
        const { search, category, status } = req.query;

        // 1. Calculate Stats (Calculate total independently of filters)
        const [[{ totalEquip }]] = await db.execute('SELECT COALESCE(SUM(stock), 0) as totalEquip FROM equipment');
        const [[{ totalAvailable }]] = await db.execute('SELECT COALESCE(SUM(available), 0) as totalAvailable FROM equipment');

        // Assuming every item not available is "borrowed" (since we don't track maintenance specifically yet in stock)
        const totalBorrowed = totalEquip - totalAvailable;

        // Note: For the "Maintenance" stat, if we ever add a specific status for it, we'd query it here. 
        // Currently setting to 0.
        const totalMaintenance = 0;

        // 2. Build Query for Data
        let query = 'SELECT * FROM equipment WHERE 1=1';
        const queryParams = [];

        if (search) {
            query += ` AND (name LIKE ? OR description LIKE ?)`;
            const searchPattern = `%${search}%`;
            queryParams.push(searchPattern, searchPattern);
        }

        if (category) {
            query += ` AND category = ?`;
            queryParams.push(category);
        }

        if (status) {
            if (status === 'พร้อมใช้งาน') {
                query += ` AND status = 'available'`;
            } else if (status === 'เหลือน้อย') {
                query += ` AND status = 'low'`;
            } else if (status === 'หมด') {
                query += ` AND status = 'out'`;
            }
        }

        query += ' ORDER BY category, name';

        const [equipment] = await db.execute(query, queryParams);

        res.json({
            success: true,
            stats: {
                total: totalEquip || 0,
                available: totalAvailable || 0,
                borrowed: totalBorrowed < 0 ? 0 : totalBorrowed,
                maintenance: totalMaintenance
            },
            equipment
        });

    } catch (error) {
        console.error('Get equipment error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// GET /api/equipment/:id - ดึงข้อมูลอุปกรณ์ตาม ID
// ===============================================
router.get('/:id', async (req, res) => {
    try {
        const [equipment] = await db.execute(
            'SELECT * FROM equipment WHERE id = ?',
            [req.params.id]
        );

        if (equipment.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบอุปกรณ์' });
        }

        res.json({ success: true, equipment: equipment[0] });

    } catch (error) {
        console.error('Get equipment detail error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// POST /api/equipment/borrow - ยืมอุปกรณ์
// ===============================================
router.post('/borrow', async (req, res) => {
    try {
        const { user_email, equipment_id, quantity, borrow_date, return_date } = req.body;

        // ค้นหา user จาก email
        const [users] = await db.execute('SELECT id FROM users WHERE email = ?', [user_email]);

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งาน' });
        }

        const userId = users[0].id;

        // ตรวจสอบจำนวนอุปกรณ์ที่มีอยู่
        const [equipment] = await db.execute(
            'SELECT * FROM equipment WHERE id = ?',
            [equipment_id]
        );

        if (equipment.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบอุปกรณ์' });
        }

        const item = equipment[0];
        const requestedQty = quantity || 1;

        if (item.available < requestedQty) {
            return res.status(400).json({
                success: false,
                message: `อุปกรณ์ไม่พอ (มีเหลือ ${item.available} ชิ้น)`
            });
        }

        // สร้างรายการยืม
        const [result] = await db.execute(`
            INSERT INTO equipment_bookings (user_id, equipment_id, quantity, borrow_date, return_date, status)
            VALUES (?, ?, ?, ?, ?, 'borrowed')
        `, [userId, equipment_id, requestedQty, borrow_date, return_date || null]);

        // อัปเดตจำนวนอุปกรณ์ที่เหลือ
        const newAvailable = item.available - requestedQty;
        let newStatus = 'available';
        if (newAvailable === 0) newStatus = 'out';
        else if (newAvailable <= 2) newStatus = 'low';

        await db.execute(
            'UPDATE equipment SET available = ?, status = ? WHERE id = ?',
            [newAvailable, newStatus, equipment_id]
        );

        res.status(201).json({
            success: true,
            message: 'ยืมอุปกรณ์สำเร็จ',
            borrowId: result.insertId
        });

    } catch (error) {
        console.error('Borrow equipment error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// PUT /api/equipment/return/:id - คืนอุปกรณ์
// ===============================================
router.put('/return/:id', authenticateToken, async (req, res) => {
    try {
        const borrowId = req.params.id;

        // ค้นหารายการยืม
        const [borrows] = await db.execute(
            'SELECT * FROM equipment_bookings WHERE id = ? AND user_id = ?',
            [borrowId, req.user.userId]
        );

        if (borrows.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการยืม' });
        }

        const borrow = borrows[0];

        // อัปเดตสถานะการยืม
        await db.execute(
            'UPDATE equipment_bookings SET status = ?, actual_return_date = CURDATE() WHERE id = ?',
            ['returned', borrowId]
        );

        // อัปเดตจำนวนอุปกรณ์
        const [equipment] = await db.execute('SELECT * FROM equipment WHERE id = ?', [borrow.equipment_id]);
        const item = equipment[0];
        const newAvailable = item.available + borrow.quantity;
        let newStatus = 'available';
        if (newAvailable <= 2) newStatus = 'low';

        await db.execute(
            'UPDATE equipment SET available = ?, status = ? WHERE id = ?',
            [newAvailable, newStatus, borrow.equipment_id]
        );

        res.json({ success: true, message: 'คืนอุปกรณ์สำเร็จ' });

    } catch (error) {
        console.error('Return equipment error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// GET /api/equipment/my/borrowed - รายการที่ยืมอยู่
// ===============================================
router.get('/my/borrowed', authenticateToken, async (req, res) => {
    try {
        const [borrows] = await db.execute(`
            SELECT 
                eb.*,
                e.name as equipment_name,
                e.image_url as equipment_image,
                e.category
            FROM equipment_bookings eb
            JOIN equipment e ON eb.equipment_id = e.id
            WHERE eb.user_id = ?
            ORDER BY eb.borrow_date DESC
        `, [req.user.userId]);

        res.json({ success: true, borrows });

    } catch (error) {
        console.error('Get my borrowed error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

module.exports = router;
