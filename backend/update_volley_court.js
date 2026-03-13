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
        
        await db.execute("UPDATE courts SET image_url = '/photo/volleyCourt.jpg' WHERE name LIKE '%วอลเลย์%'");
        console.log("Volleyball court image updated!");
    } catch (e) {
        console.error("SQL Error:", e.message);
    }
    process.exit(0);
}
run();