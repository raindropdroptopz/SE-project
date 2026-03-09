const mysql = require('mysql2/promise');
require('dotenv').config({path: './backend/.env'});

async function run() {
    const db = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'payap_sports'
    });
    
    try {
        await db.query(`ALTER TABLE equipment_bookings ADD COLUMN booking_id INT NULL`);
        try {
            await db.query(`ALTER TABLE equipment_bookings ADD FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE`);
        } catch (f) {
            console.log("Foreign key constraint error:", f.message);
        }
        console.log("Database schema updated successfully.");
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log("Column booking_id already exists.");
        } else {
            console.error("Error updating schema:", e.message);
        }
    }
    process.exit(0);
}
run();
