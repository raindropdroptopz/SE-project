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
        const [courts] = await db.execute('SELECT id, name, image_url FROM courts');
        console.log("Courts:", courts);
        const [eqps] = await db.execute('SELECT id, name, image_url FROM equipment');
        console.log("Equipment:", eqps);
    } catch (e) {
        console.error("SQL Error:", e.message);
    }
    process.exit(0);
}
run();
