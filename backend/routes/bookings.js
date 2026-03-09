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
// GET /api/bookings - ดึงรายการจองทั้งหมด (สำหรับ Calendar)
// ===============================================
router.get('/', async (req, res) => {
    try {
        const [bookings] = await db.execute(`
            SELECT 
                b.id,
                b.booking_date,
                b.start_time,
                b.end_time,
                b.status,
                b.players,
                c.name as court_name,
                u.full_name as user_name
            FROM bookings b
            JOIN courts c ON b.court_id = c.id
            JOIN users u ON b.user_id = u.id
            WHERE b.status != 'cancelled'
            ORDER BY b.booking_date DESC, b.start_time ASC
        `);

        // แปลงเป็น FullCalendar format
        const events = bookings.map(booking => {
            const d = new Date(booking.booking_date);
            const dateStr = [
                d.getFullYear(),
                String(d.getMonth() + 1).padStart(2, '0'),
                String(d.getDate()).padStart(2, '0')
            ].join('-');

            return {
                id: booking.id,
                title: `${booking.court_name} - ${booking.user_name}`,
                start: `${dateStr}T${booking.start_time}`,
                end: `${dateStr}T${booking.end_time}`,
                color: booking.status === 'confirmed' ? '#667eea' : '#ffc107',
                extendedProps: {
                    status: booking.status,
                    players: booking.players,
                    courtName: booking.court_name
                }
            };
        });

        res.json(events);

    } catch (error) {
        console.error('Get bookings error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// GET /api/bookings/my - ดึงการจองของผู้ใช้
// ===============================================
router.get('/my', authenticateToken, async (req, res) => {
    try {
        const [bookings] = await db.execute(`
            SELECT 
                b.*,
                c.name as court_name,
                c.image_url as court_image
            FROM bookings b
            JOIN courts c ON b.court_id = c.id
            WHERE b.user_id = ?
            ORDER BY b.booking_date DESC, b.start_time ASC
        `, [req.user.userId]);

        res.json({ success: true, bookings });

    } catch (error) {
        console.error('Get my bookings error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// POST /api/bookings - สร้างการจองใหม่
// ===============================================
router.post('/', async (req, res) => {
    try {
        const { user_email, court_type, booking_date, start_time, end_time, players, note, equipments } = req.body;

        // ค้นหา user จาก email
        const [users] = await db.execute('SELECT id FROM users WHERE email = ?', [user_email]);

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งาน' });
        }

        const userId = users[0].id;

        // ค้นหา court จากชื่อ
        const [courts] = await db.execute('SELECT id FROM courts WHERE name LIKE ?', [`%${court_type}%`]);

        if (courts.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบสนามกีฬา' });
        }

        const courtId = courts[0].id;

        // ตรวจสอบว่าช่วงเวลานี้ว่างหรือไม่
        const [existingBookings] = await db.execute(`
            SELECT id FROM bookings 
            WHERE court_id = ? 
            AND booking_date = ? 
            AND status != 'cancelled'
            AND (
                (start_time <= ? AND end_time > ?) OR
                (start_time < ? AND end_time >= ?) OR
                (start_time >= ? AND end_time <= ?)
            )
        `, [courtId, booking_date, start_time, start_time, end_time, end_time, start_time, end_time]);

        if (existingBookings.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'ช่วงเวลานี้ถูกจองแล้ว กรุณาเลือกเวลาอื่น'
            });
        }

        // Validate all equipment stock and build note
        let finalNote = note || '';
        if (equipments && Array.isArray(equipments) && equipments.length > 0) {
            for (const item of equipments) {
                const [eqRows] = await db.execute('SELECT available FROM equipment WHERE id = ?', [item.id]);
                if (eqRows.length > 0 && eqRows[0].available < item.quantity) {
                    return res.status(400).json({ success: false, message: `อุปกรณ์ ${item.name} มีจำนวนไม่เพียงพอ` });
                }
            }
            const eqText = 'อุปกรณ์ที่ยืม: ' + equipments.map(e => `${e.name} (${e.quantity})`).join(', ');
            finalNote = finalNote ? `${finalNote} | ${eqText}` : eqText;
        }

        // สร้างการจอง (สถานะ pending รอ admin อนุมัติ)
        const [result] = await db.execute(`
            INSERT INTO bookings (user_id, court_id, booking_date, start_time, end_time, players, note, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        `, [userId, courtId, booking_date, start_time, end_time, players || 1, finalNote || null]);

        // Insert equipment bookings and update stock
        if (equipments && Array.isArray(equipments) && equipments.length > 0) {
            for (const item of equipments) {
                // insert
                await db.execute(`
                    INSERT INTO equipment_bookings (user_id, equipment_id, quantity, borrow_date, return_date, status)
                    VALUES (?, ?, ?, ?, ?, 'pending')
                `, [userId, item.id, item.quantity, booking_date, booking_date]);

                // update equipment table stock
                const [eqRows] = await db.execute('SELECT available FROM equipment WHERE id = ?', [item.id]);
                if (eqRows.length > 0) {
                    let newAvailable = eqRows[0].available - item.quantity;
                    let newStatus = 'available';
                    if (newAvailable === 0) newStatus = 'out';
                    else if (newAvailable <= 2) newStatus = 'low';

                    await db.execute(
                        'UPDATE equipment SET available = ?, status = ? WHERE id = ?',
                        [newAvailable, newStatus, item.id]
                    );
                }
            }
        }

        res.status(201).json({
            success: true,
            message: 'จองสนามสำเร็จ',
            bookingId: result.insertId
        });

    } catch (error) {
        console.error('Create booking error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// PUT /api/bookings/:id/cancel - ยกเลิกการจอง
// ===============================================
router.put('/:id/cancel', authenticateToken, async (req, res) => {
    try {
        const bookingId = req.params.id;

        // ตรวจสอบว่าเป็นเจ้าของการจองหรือไม่
        const [bookings] = await db.execute(
            'SELECT * FROM bookings WHERE id = ? AND user_id = ?',
            [bookingId, req.user.userId]
        );

        if (bookings.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบการจอง' });
        }

        await db.execute(
            'UPDATE bookings SET status = ? WHERE id = ?',
            ['cancelled', bookingId]
        );

        res.json({ success: true, message: 'ยกเลิกการจองสำเร็จ' });

    } catch (error) {
        console.error('Cancel booking error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// GET /api/courts - ดึงรายการสนามทั้งหมด
// ===============================================
router.get('/courts', async (req, res) => {
    try {
        const [courts] = await db.execute('SELECT * FROM courts WHERE status = "available"');
        res.json({ success: true, courts });
    } catch (error) {
        console.error('Get courts error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

module.exports = router;
