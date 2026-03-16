const mysql = require('mysql2/promise');
require('dotenv').config({path: './backend/.env'});

async function run() {
    try {
        const db = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'payap_sports'
        });
        const [bookings] = await db.execute(`
            SELECT 
                b.*,
                c.name as court_name,
                c.image_url as court_image,
                (
                    SELECT JSON_ARRAYAGG(
                        JSON_OBJECT(
                            'id', e.id,
                            'name', e.name,
                            'quantity', eb.quantity
                        )
                    )
                    FROM equipment_bookings eb
                    JOIN equipment e ON eb.equipment_id = e.id
                    WHERE eb.booking_id = b.id
                ) as equipments
            FROM bookings b
            JOIN courts c ON b.court_id = c.id
            WHERE b.user_id = 1
            ORDER BY b.booking_date DESC, b.start_time ASC
        `);
        console.log("Success", bookings.length);
    } catch (e) {
        console.error("SQL Error:", e.message);
    }
    process.exit(0);
}
run();
