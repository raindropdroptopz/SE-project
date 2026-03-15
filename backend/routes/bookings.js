const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ตั้งค่าที่เก็บไฟล์อัปโหลดสลิปเงินโอน
const uploadDir = path.join(__dirname, '../../frontend/uploads/receipts');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, 'receipt-' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

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
// GET /api/bookings/slots - ดึงช่วงเวลาที่ถูกจองแล้วของสนามในวันที่กำหนด
// ===============================================
router.get('/slots', async (req, res) => {
    try {
        const { courtType, date } = req.query;

        if (!courtType || !date) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุสนามและวันที่' });
        }

        // ค้นหา court_id จากชื่อ
        const [courts] = await db.execute('SELECT id FROM courts WHERE name LIKE ?', [`%${courtType}%`]);
        if (courts.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบสนามกีฬา' });
        }

        const courtId = courts[0].id;

        // ดึงการจองทั้งหมดของสนามนี้ในวันนี้ที่ไม่ได้ยกเลิก
        const [bookings] = await db.execute(`
            SELECT start_time, end_time 
            FROM bookings 
            WHERE court_id = ? 
            AND booking_date = ? 
            AND status != 'cancelled'
        `, [courtId, date]);

        // แปลงเวลาให้เป็น format "HH:mm-HH:mm" (เฉพาะชั่วโมงชั่วโมงชนชั่วโมง)
        // เพราะ frontend ส่งมา format นี้: ['08:00-09:00', '09:00-10:00', ...]
        const bookedSlots = bookings.map(b => {
            const start = b.start_time.substring(0, 5); // เอาแค่ HH:mm
            const end = b.end_time.substring(0, 5);
            return `${start}-${end}`;
        });

        res.json({ success: true, bookedSlots });

    } catch (error) {
        console.error('Get booked slots error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

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
// PUT /api/bookings/:id - แก้ไขการจอง (เวลาและอุปกรณ์)
// ===============================================
router.put('/:id', authenticateToken, async (req, res) => {
    let connection;
    try {
        const bookingId = req.params.id;
        const { start_time, end_time, note, equipments } = req.body;

        connection = await db.getConnection();
        await connection.beginTransaction();

        // Lock the booking row
        const [bookings] = await connection.execute(
            'SELECT * FROM bookings WHERE id = ? AND user_id = ? AND status != "cancelled" FOR UPDATE',
            [bookingId, req.user.userId]
        );

        if (bookings.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'ไม่พบการจอง หรือการจองถูกยกเลิกแล้ว' });
        }

        const booking = bookings[0];

        // 1. ตรวจสอบเวลาว่าง (ถ้ามีการเปลี่ยนเวลา) ล็อคช่วงเวลาเพื่อป้องกันการจองซ้อนทับ
        if (start_time !== booking.start_time || end_time !== booking.end_time) {
            const [existingBookings] = await connection.execute(`
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
                FOR UPDATE
            `, [booking.court_id, booking.booking_date, bookingId, start_time, start_time, end_time, end_time, start_time, end_time]);

            if (existingBookings.length > 0) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'ช่วงเวลานี้ถูกจองแล้ว กรุณาเลือกเวลาอื่น'
                });
            }
        }

        // 2. (ลบส่วนคืนสต็อกด้วย booking_id ออก เพราะไม่มีฟิลด์นี้ในฐานข้อมูลจริง)

        // 3. ตรวจสอบสต็อกอุปกรณ์ใหม่ & จัดการ note
        let finalNote = note || '';
        if (equipments && Array.isArray(equipments) && equipments.length > 0) {
            for (const item of equipments) {
                // Check stock with FOR UPDATE lock
                const [eqRows] = await connection.execute('SELECT available FROM equipment WHERE id = ? FOR UPDATE', [item.id]);
                if (eqRows.length === 0 || eqRows[0].available < item.quantity) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: `อุปกรณ์ ${item.name} มีจำนวนไม่เพียงพอ` });
                }
            }
            const eqText = 'อุปกรณ์ที่ยืมเพิ่มเติม: ' + equipments.map(e => `${e.name} (${e.quantity})`).join(', ');
            finalNote = finalNote ? `${finalNote} | ${eqText}` : eqText;
        }

        // 4. บันทึกข้อมูลการเปลี่ยนแปลงอุปกรณ์ใหม่ลง DB
        if (equipments && Array.isArray(equipments) && equipments.length > 0) {
            for (const item of equipments) {
                await connection.execute(`
                    INSERT INTO equipment_bookings (user_id, equipment_id, quantity, borrow_date, return_date, status)
                    VALUES (?, ?, ?, ?, ?, 'pending')
                `, [req.user.userId, item.id, item.quantity, booking.booking_date, booking.booking_date]);

                const [eqRows] = await connection.execute('SELECT available FROM equipment WHERE id = ?', [item.id]);
                if (eqRows.length > 0) {
                    let newAvailable = eqRows[0].available - item.quantity;
                    let newStatus = 'available';
                    if (newAvailable === 0) newStatus = 'out';
                    else if (newAvailable <= 2) newStatus = 'low';
                    await connection.execute('UPDATE equipment SET available = ?, status = ? WHERE id = ?', [newAvailable, newStatus, item.id]);
                }
            }
        }

        // 5. อัปเดตข้อมูลตารางการจอง (เปลี่ยนสถานะกลับเป็น pending ให้ admin รับทราบ)
        await connection.execute(
            'UPDATE bookings SET start_time = ?, end_time = ?, note = ?, status = ? WHERE id = ?',
            [start_time, end_time, finalNote || null, 'pending', bookingId]
        );

        await connection.commit();

        res.json({ success: true, message: 'แก้ไขการจองสำเร็จ กรุณารอผู้ดูแลระบบยืนยันอีกครั้ง' });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Update booking error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    } finally {
        if (connection) connection.release();
    }
});

// ===============================================
// POST /api/bookings - สร้างการจองใหม่
// ===============================================
router.post('/', upload.single('payment_slip'), async (req, res) => {
    let connection;
    try {
        const { user_email, court_type, booking_date, start_time, end_time, players, note } = req.body;
        let equipments = [];
        if (req.body.equipments) {
            try { equipments = JSON.parse(req.body.equipments); } catch(e) {}
        }
        const payment_slip_url = req.file ? '/photo/slips/' + req.file.filename : null;

        // ค้นหา user จาก email
        const [users] = await db.execute('SELECT id FROM users WHERE email = ?', [user_email]);

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งาน' });
        }

        const userId = users[0].id;

        // Get a dedicated connection for the transaction
        connection = await db.getConnection();
        await connection.beginTransaction();

        // ค้นหา court จากชื่อ
        const [courts] = await connection.execute('SELECT id, price FROM courts WHERE name LIKE ?', [`%${court_type}%`]);

        if (courts.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'ไม่พบสนามกีฬา' });
        }

        const courtId = courts[0].id;
        const courtPriceRate = courts[0].price || 0;

        // ตรวจสอบว่าช่วงเวลานี้ว่างหรือไม่ (ใช้ FOR UPDATE เพื่อป้องกันการจองชนกันในเสี้ยววินาที)
        const [existingBookings] = await connection.execute(`
            SELECT id FROM bookings 
            WHERE court_id = ? 
            AND booking_date = ? 
            AND status != 'cancelled'
            AND (
                (start_time <= ? AND end_time > ?) OR
                (start_time < ? AND end_time >= ?) OR
                (start_time >= ? AND end_time <= ?)
            )
            FOR UPDATE
        `, [courtId, booking_date, start_time, start_time, end_time, end_time, start_time, end_time]);

        if (existingBookings.length > 0) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'ช่วงเวลานี้ถูกจองแล้ว กรุณาเลือกเวลาอื่น'
            });
        }

        // Validate all equipment stock and build note
        let finalNote = note || '';
        if (equipments && Array.isArray(equipments) && equipments.length > 0) {
            for (const item of equipments) {
                // Check stock with FOR UPDATE lock
                const [eqRows] = await connection.execute('SELECT available FROM equipment WHERE id = ? FOR UPDATE', [item.id]);
                if (eqRows.length === 0 || eqRows[0].available < item.quantity) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: `อุปกรณ์ ${item.name} มีจำนวนไม่เพียงพอ` });
                }
            }
            const eqText = 'อุปกรณ์ที่ยืม: ' + equipments.map(e => `${e.name} (${e.quantity})`).join(', ');
            finalNote = finalNote ? `${finalNote} | ${eqText}` : eqText;
        }

        // สร้างการจอง (สถานะ pending รอ admin อนุมัติ)
        const [result] = await connection.execute(`
            INSERT INTO bookings (user_id, court_id, booking_date, start_time, end_time, players, note, status, payment_slip)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `, [userId, courtId, booking_date, start_time, end_time, players || 1, finalNote || null, payment_slip_url]);

        // Insert equipment bookings and update stock
        if (equipments && Array.isArray(equipments) && equipments.length > 0) {
            for (const item of equipments) {
                // insert
                await connection.execute(`
                    INSERT INTO equipment_bookings (user_id, equipment_id, quantity, borrow_date, return_date, status)
                    VALUES (?, ?, ?, ?, ?, 'pending')
                `, [userId, item.id, item.quantity, booking_date, booking_date]);

                // update equipment table stock (we already ensured it has enough and locked the row above)
                const [eqRows] = await connection.execute('SELECT available FROM equipment WHERE id = ?', [item.id]);
                if (eqRows.length > 0) {
                    let newAvailable = eqRows[0].available - item.quantity;
                    let newStatus = 'available';
                    if (newAvailable === 0) newStatus = 'out';
                    else if (newAvailable <= 2) newStatus = 'low';

                    await connection.execute(
                        'UPDATE equipment SET available = ?, status = ? WHERE id = ?',
                        [newAvailable, newStatus, item.id]
                    );
                }
            }
        }

        // ── สร้าง Payment Record ──────────────────────────────────────────
        // คำนวณชั่วโมงจอง
        const startParts = start_time.split(':').map(Number);
        const endParts = end_time.split(':').map(Number);
        const startMins = startParts[0] * 60 + (startParts[1] || 0);
        const endMins = endParts[0] * 60 + (endParts[1] || 0);
        const courtHours = parseFloat(((endMins - startMins) / 60).toFixed(1));
        const courtSubtotal = Math.round(courtPriceRate * courtHours);

        // คำนวณราคาอุปกรณ์
        let equipmentSubtotal = 0;
        const paymentItemRows = [];
        if (equipments && equipments.length > 0) {
            for (const item of equipments) {
                const [eqPriceRows] = await connection.execute('SELECT price FROM equipment WHERE id = ?', [item.id]);
                const unitPrice = eqPriceRows.length > 0 ? (eqPriceRows[0].price || 0) : 0;
                const itemSubtotal = unitPrice * item.quantity;
                equipmentSubtotal += itemSubtotal;
                paymentItemRows.push({ id: item.id, name: item.name, unit_price: unitPrice, quantity: item.quantity, subtotal: itemSubtotal });
            }
        }
        const totalAmount = courtSubtotal + equipmentSubtotal;

        // Insert into payments
        const [paymentResult] = await connection.execute(`
            INSERT INTO payments (booking_id, user_id, court_price_rate, court_hours, court_subtotal, equipment_subtotal, total_amount, payment_slip, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `, [result.insertId, userId, courtPriceRate, courtHours, courtSubtotal, equipmentSubtotal, totalAmount, payment_slip_url]);

        // Insert payment_items (one row per equipment)
        for (const pi of paymentItemRows) {
            await connection.execute(`
                INSERT INTO payment_items (payment_id, equipment_id, equipment_name, unit_price, quantity, subtotal)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [paymentResult.insertId, pi.id, pi.name, pi.unit_price, pi.quantity, pi.subtotal]);
        }

        await connection.commit();

        res.status(201).json({
            success: true,
            message: 'จองสนามสำเร็จ',
            bookingId: result.insertId,
            paymentId: paymentResult.insertId,
            totalAmount
        });


    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Create booking error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// ===============================================
// POST /api/bookings/with-payment - สร้างการจองใหม่พร้อมหลักฐานการโอนเงิน
// ===============================================
router.post('/with-payment', authenticateToken, upload.single('slip'), async (req, res) => {
    let connection;
    try {
        const bookingDataStr = req.body.bookingData;
        if (!bookingDataStr) {
            return res.status(400).json({ success: false, message: 'ข้อมูลการจองไม่ถูกต้อง' });
        }

        const data = JSON.parse(bookingDataStr);
        const { court_type, booking_date, start_time, end_time, players, note, equipments } = data;
        const userId = req.user.userId;

        // Path ของสลิปที่อัปโหลด
        const payment_slip_url = req.file ? '/photo/slips/' + req.file.filename : null;

        connection = await db.getConnection();
        await connection.beginTransaction();

        // ดึงข้อมูลสนาม พร้อม price
        const [courts] = await connection.execute('SELECT id, price FROM courts WHERE name LIKE ?', [`%${court_type}%`]);
        if (courts.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'ไม่พบสนามกีฬา' });
        }
        const courtId = courts[0].id;
        const courtPriceRate = courts[0].price || 0;

        // ตรวจสอบช่วงเวลาว่าง
        const [existingBookings] = await connection.execute(`
            SELECT id FROM bookings 
            WHERE court_id = ? AND booking_date = ? AND status != 'cancelled'
            AND (
                (start_time <= ? AND end_time > ?) OR
                (start_time < ? AND end_time >= ?) OR
                (start_time >= ? AND end_time <= ?)
            ) FOR UPDATE
        `, [courtId, booking_date, start_time, start_time, end_time, end_time, start_time, end_time]);

        if (existingBookings.length > 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'ช่วงเวลานี้ถูกจองแล้ว กรุณาเลือกเวลาอื่น' });
        }

        // ตรวจสอบ stock อุปกรณ์
        let finalNote = note || '';
        if (equipments && Array.isArray(equipments) && equipments.length > 0) {
            for (const item of equipments) {
                const [eqRows] = await connection.execute('SELECT available FROM equipment WHERE id = ? FOR UPDATE', [item.id]);
                if (eqRows.length === 0 || eqRows[0].available < item.quantity) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: `อุปกรณ์ ${item.name} มีจำนวนไม่เพียงพอ` });
                }
            }
            const eqText = 'อุปกรณ์ที่ยืม: ' + equipments.map(e => `${e.name} (${e.quantity})`).join(', ');
            finalNote = finalNote ? `${finalNote} | ${eqText}` : eqText;
        }

        // Insert booking
        const [result] = await connection.execute(`
            INSERT INTO bookings (user_id, court_id, booking_date, start_time, end_time, players, note, status, payment_slip)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `, [userId, courtId, booking_date, start_time, end_time, players || 1, finalNote || null, payment_slip_url]);
        const bookingId = result.insertId;

        // Insert equipment_bookings + update stock
        if (equipments && Array.isArray(equipments) && equipments.length > 0) {
            for (const item of equipments) {
                await connection.execute(`
                    INSERT INTO equipment_bookings (user_id, equipment_id, quantity, borrow_date, return_date, status)
                    VALUES (?, ?, ?, ?, ?, 'pending')
                `, [userId, item.id, item.quantity, booking_date, booking_date]);

                const [eqRows] = await connection.execute('SELECT available FROM equipment WHERE id = ?', [item.id]);
                if (eqRows.length > 0) {
                    let newAvail = eqRows[0].available - item.quantity;
                    let newStatus = newAvail === 0 ? 'out' : newAvail <= 2 ? 'low' : 'available';
                    await connection.execute('UPDATE equipment SET available = ?, status = ? WHERE id = ?', [newAvail, newStatus, item.id]);
                }
            }
        }

        // ── คำนวณและบันทึก Payment Record ──────────────────────────────
        const startParts = start_time.split(':').map(Number);
        const endParts = end_time.split(':').map(Number);
        const startMins = startParts[0] * 60 + (startParts[1] || 0);
        const endMins = endParts[0] * 60 + (endParts[1] || 0);
        const courtHours = parseFloat(((endMins - startMins) / 60).toFixed(1));
        const courtSubtotal = Math.round(courtPriceRate * courtHours);

        let equipmentSubtotal = 0;
        const paymentItemRows = [];
        if (equipments && equipments.length > 0) {
            for (const item of equipments) {
                const [eqPriceRows] = await connection.execute('SELECT price FROM equipment WHERE id = ?', [item.id]);
                const unitPrice = eqPriceRows.length > 0 ? (eqPriceRows[0].price || 0) : 0;
                const itemSubtotal = unitPrice * item.quantity;
                equipmentSubtotal += itemSubtotal;
                paymentItemRows.push({ id: item.id, name: item.name, unit_price: unitPrice, quantity: item.quantity, subtotal: itemSubtotal });
            }
        }
        const totalAmount = courtSubtotal + equipmentSubtotal;

        // Insert into payments
        const [paymentResult] = await connection.execute(`
            INSERT INTO payments (booking_id, user_id, court_price_rate, court_hours, court_subtotal, equipment_subtotal, total_amount, payment_slip, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `, [bookingId, userId, courtPriceRate, courtHours, courtSubtotal, equipmentSubtotal, totalAmount, payment_slip_url]);

        // Insert payment_items (per equipment)
        for (const pi of paymentItemRows) {
            await connection.execute(`
                INSERT INTO payment_items (payment_id, equipment_id, equipment_name, unit_price, quantity, subtotal)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [paymentResult.insertId, pi.id, pi.name, pi.unit_price, pi.quantity, pi.subtotal]);
        }

        await connection.commit();

        res.status(201).json({
            success: true,
            message: 'จองสนามและส่งสลิปสำเร็จ รอการยืนยันจากแอดมิน',
            bookingId: bookingId,
            paymentId: paymentResult.insertId,
            totalAmount
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Create booking w/ payment error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ: ' + error.message });
    } finally {
        if (connection) connection.release();
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

        // 1. (ยกเลิกการคืนสต็อกอุปกรณ์ด้วย booking_id เพราะไม่มีฟิลด์นี้ในฐานข้อมูลจริง)

        // 2. ลบออกไปจาก database เลยตาม request ของ user (อุปกรณ์จะถูกลบตามเพราะ CASCADE DELETE)
        await db.execute(
            'DELETE FROM bookings WHERE id = ?',
            [bookingId]
        );

        res.json({ success: true, message: 'ยกเลิกการจองสำเร็จ' });

    } catch (error) {
        console.error('Cancel booking error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// GET /api/bookings/courts - ดึงรายการสนามทั้งหมด (เฉพาะที่ใช้งานได้)
// ===============================================
router.get('/courts', async (req, res) => {
    try {
        const [courts] = await db.execute('SELECT * FROM courts WHERE status != "maintenance"');
        res.json({ success: true, courts });
    } catch (error) {
        console.error('Get courts error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// ===============================================
// GET /api/bookings/courts/:id - ดึงข้อมูลสนามตาม ID
// ===============================================
router.get('/courts/:id', async (req, res) => {
    try {
        const [courts] = await db.execute('SELECT * FROM courts WHERE id = ?', [req.params.id]);
        if (courts.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบสนามกีฬา' });
        }
        res.json({ success: true, court: courts[0] });
    } catch (error) {
        console.error('Get court error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

module.exports = router;