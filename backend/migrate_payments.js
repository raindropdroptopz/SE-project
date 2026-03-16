const mysql = require('mysql2/promise');
require('dotenv').config({ path: __dirname + '/.env' });

async function migrate() {
    const db = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'payap_sports'
    });

    console.log('Connected to DB');

    // 1. Add price to equipment if not exists
    try {
        await db.query(`ALTER TABLE equipment ADD COLUMN price INT DEFAULT 0`);
        console.log('✅ Added equipment.price column');
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') console.log('ℹ️  equipment.price already exists');
        else throw e;
    }

    // 2. Create payments table
    await db.query(`
        CREATE TABLE IF NOT EXISTS payments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            booking_id INT NOT NULL,
            user_id INT NOT NULL,
            court_price_rate INT NOT NULL COMMENT 'ราคาสนาม/ชม. ณ เวลาที่จอง',
            court_hours DECIMAL(4,1) NOT NULL COMMENT 'จำนวนชั่วโมงที่จอง',
            court_subtotal INT NOT NULL COMMENT 'court_price_rate x court_hours',
            equipment_subtotal INT DEFAULT 0 COMMENT 'ราคาอุปกรณ์รวม',
            total_amount INT NOT NULL COMMENT 'ยอดรวมทั้งหมด',
            payment_slip VARCHAR(255) NULL COMMENT 'path รูปสลิป',
            status ENUM('pending','verified','rejected') DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Created payments table');

    // 3. Create payment_items table
    await db.query(`
        CREATE TABLE IF NOT EXISTS payment_items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            payment_id INT NOT NULL,
            equipment_id INT NOT NULL,
            equipment_name VARCHAR(255),
            unit_price INT DEFAULT 0,
            quantity INT DEFAULT 1,
            subtotal INT DEFAULT 0,
            FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Created payment_items table');

    await db.end();
    console.log('Migration complete!');
    process.exit(0);
}

migrate().catch(e => {
    console.error('Migration failed:', e);
    process.exit(1);
});
