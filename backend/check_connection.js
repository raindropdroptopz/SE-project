const mysql = require('mysql2/promise');
require('dotenv').config();

async function check() {
    console.log('--- Checking Connection ---');
    console.log('Config:', {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT
    });

    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'payap_sports',
            port: process.env.DB_PORT || 3306
        });
        console.log('✅ MySQL Connection: SUCCESS');
        
        const [rows] = await connection.execute('SHOW TABLES LIKE "users"');
        if (rows.length > 0) {
            console.log('✅ Table "users": FOUND');
        } else {
            console.log('❌ Table "users": NOT FOUND');
        }
        await connection.end();
    } catch (err) {
        console.log('❌ MySQL Connection: FAILED');
        console.error('Error Message:', err.message);
    }
}

check();
