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

        const bookingIds = bookings.map(b => b.id);
        let equipmentMap = {};

        if (bookingIds.length > 0) {
            const [equipmentRows] = await db.query(`
                SELECT 
                    eb.booking_id,
                    e.id,
                    e.name,
                    eb.quantity
                FROM equipment_bookings eb
                JOIN equipment e ON eb.equipment_id = e.id
                WHERE eb.booking_id IN (?)
            `, [bookingIds]);

            equipmentRows.forEach(row => {
                if (!equipmentMap[row.booking_id]) {
                    equipmentMap[row.booking_id] = [];
                }
                equipmentMap[row.booking_id].push({
                    id: row.id,
                    name: row.name,
                    quantity: row.quantity
                });
            });
        }

        bookings.forEach(b => {
            b.equipments = equipmentMap[b.id] || [];
        });

        res.json({ success: true, bookings });

    } catch (error) {
        console.error('Get my bookings error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// PUT /api/bookings/:id - แก้ไขการจอง (เวลาและอุปกรณ์)
// ===============================================
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const bookingId = req.params.id;
        const { start_time, end_time, note, equipments } = req.body;

        const [bookings] = await db.execute(
            'SELECT * FROM bookings WHERE id = ? AND user_id = ? AND status != "cancelled"',
            [bookingId, req.user.userId]
        );

        if (bookings.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบการจอง หรือการจองถูกยกเลิกแล้ว' });
        }

        const booking = bookings[0];

        // 1. ตรวจสอบเวลาว่าง (ถ้ามีการเปลี่ยนเวลา)
        if (start_time !== booking.start_time || end_time !== booking.end_time) {
            const [existingBookings] = await db.execute(`
                SELECT id FROM bookings 
                WHERE court_id = ? 
                AND booking_date = ? 
                AND id != ?
                AND status != 'cancelled'
                AND (
                    (start_time <= ? AND end_time > ?) OR
                    (start_time < ? AND end_time >= ?) OR
                    (start_time >= ? AND end_time <= ?)
                )
            `, [booking.court_id, booking.booking_date, bookingId, start_time, start_time, end_time, end_time, start_time, end_time]);

            if (existingBookings.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'ช่วงเวลานี้ถูกจองแล้ว กรุณาเลือกเวลาอื่น'
                });
            }
        }

        // 2. คืนสต็อกอุปกรณ์เดิม
        const [oldEqs] = await db.execute('SELECT equipment_id, quantity FROM equipment_bookings WHERE booking_id = ?', [bookingId]);

        for (const old of oldEqs) {
            const [eqRows] = await db.execute('SELECT available FROM equipment WHERE id = ?', [old.equipment_id]);
            if (eqRows.length > 0) {
                let newAvailable = eqRows[0].available + old.quantity;
                let newStatus = 'available';
                if (newAvailable <= 2 && newAvailable > 0) newStatus = 'low';
                else if (newAvailable === 0) newStatus = 'out';
                await db.execute('UPDATE equipment SET available = ?, status = ? WHERE id = ?', [newAvailable, newStatus, old.equipment_id]);
            }
        }
        await db.execute('DELETE FROM equipment_bookings WHERE booking_id = ?', [bookingId]);

        // 3. ตรวจสอบสต็อกอุปกรณ์ใหม่ & จัดการ note
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

        // 4. บันทึกข้อมูลการเปลี่ยนแปลงอุปกรณ์ใหม่ลง DB
        if (equipments && Array.isArray(equipments) && equipments.length > 0) {
            for (const item of equipments) {
                await db.execute(`
                    INSERT INTO equipment_bookings (user_id, equipment_id, booking_id, quantity, borrow_date, return_date, status)
                    VALUES (?, ?, ?, ?, ?, ?, 'pending')
                `, [req.user.userId, item.id, bookingId, item.quantity, booking.booking_date, booking.booking_date]);

                const [eqRows] = await db.execute('SELECT available FROM equipment WHERE id = ?', [item.id]);
                if (eqRows.length > 0) {
                    let newAvailable = eqRows[0].available - item.quantity;
                    let newStatus = 'available';
                    if (newAvailable === 0) newStatus = 'out';
                    else if (newAvailable <= 2) newStatus = 'low';
                    await db.execute('UPDATE equipment SET available = ?, status = ? WHERE id = ?', [newAvailable, newStatus, item.id]);
                }
            }
        }

        // 5. อัปเดตข้อมูลตารางการจอง (ตาราง bookings)
        await db.execute(
            'UPDATE bookings SET start_time = ?, end_time = ?, note = ? WHERE id = ?',
            [start_time, end_time, finalNote || null, bookingId]
        );

        res.json({ success: true, message: 'แก้ไขการจองสำเร็จ' });

    } catch (error) {
        console.error('Update booking error:', error);
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
                    INSERT INTO equipment_bookings (user_id, equipment_id, booking_id, quantity, borrow_date, return_date, status)
                    VALUES (?, ?, ?, ?, ?, ?, 'pending')
                `, [userId, item.id, result.insertId, item.quantity, booking_date, booking_date]);

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