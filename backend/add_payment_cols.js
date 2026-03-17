require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
    try {
        const pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'sports_booking_db',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        console.log('Connected to DB. Executing ALTER TABLE...');
        
        await pool.execute(`
            ALTER TABLE equipment_bookings
            ADD COLUMN total_price INT DEFAULT 0,
            ADD COLUMN payment_slip VARCHAR(255) NULL
        `);

        console.log('Columns added successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

main();
