const db = require('./config/database');

async function fixDatabase() {
    try {
        console.log('--- กำลังเริ่มการอัปเดตฐานข้อมูล ---');

        // 1. เพิ่มคอลัมน์ payment_slip ในตาราง bookings
        console.log('1. ตรวจสอบคอลัมน์ payment_slip ในตาราง bookings...');
        const [bookingCols] = await db.execute("SHOW COLUMNS FROM bookings LIKE 'payment_slip'");
        if (bookingCols.length === 0) {
            await db.execute("ALTER TABLE bookings ADD COLUMN payment_slip VARCHAR(255) DEFAULT NULL");
            console.log('✅ เพิ่มคอลัมน์ payment_slip ในตาราง bookings สำเร็จ');
        } else {
            console.log('ℹ️ คอลัมน์ payment_slip มีอยู่แล้ว');
        }

        // 2. ตรวจสอบคอลัมน์ price ในตาราง courts
        console.log('2. ตรวจสอบคอลัมน์ price ในตาราง courts...');
        const [courtCols] = await db.execute("SHOW COLUMNS FROM courts LIKE 'price'");
        if (courtCols.length === 0) {
            await db.execute("ALTER TABLE courts ADD COLUMN price INT DEFAULT 300");
            console.log('✅ เพิ่มคอลัมน์ price ในตาราง courts สำเร็จ');
        } else {
            console.log('ℹ️ คอลัมน์ price ในตาราง courts มีอยู่แล้ว');
        }

        // 3. ตรวจสอบคอลัมน์ price ในตาราง equipment
        console.log('3. ตรวจสอบคอลัมน์ price ในตาราง equipment...');
        const [eqCols] = await db.execute("SHOW COLUMNS FROM equipment LIKE 'price'");
        if (eqCols.length === 0) {
            await db.execute("ALTER TABLE equipment ADD COLUMN price INT DEFAULT 0");
            console.log('✅ เพิ่มคอลัมน์ price ในตาราง equipment สำเร็จ');
        } else {
            console.log('ℹ️ คอลัมน์ price ในตาราง equipment มีอยู่แล้ว');
        }

        console.log('\n--- อัปเดตฐานข้อมูลเสร็จสมบูรณ์! ---');
        console.log('ตอนนี้คุณสามารถลองกดจองสนามอีกครั้งได้เลยครับ');

    } catch (error) {
        console.error('❌ เกิดข้อผิดพลาดในการอัปเดตฐานข้อมูล:', error.message);
    } finally {
        process.exit(0);
    }
}

fixDatabase();
