const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function testAll() {
    const db = await mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'payap_sports'
    });

    const [users] = await db.execute("SELECT id, email FROM users");
    console.log(`Found ${users.length} users. Testing Equipment API for each...`);

    for (const u of users) {
        const token = jwt.sign({ userId: u.id, role: 'student' }, process.env.JWT_SECRET || 'your_super_secret_key_change_this_in_production');
        
        try {
            const res = await fetch('http://localhost:3000/api/equipment/my/borrowed', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            const text = await res.text();
            try {
                const data = JSON.parse(text);
                console.log(`User ${u.id}: Success=${data.success}, Borrows=${data.borrows ? data.borrows.length : 'N/A'}`);
                if (!data.success) {
                    console.log("Error response:", data);
                }
            } catch(e) {
                console.log(`User ${u.id}: Invalid JSON response! => ${text.substring(0, 100)}`);
            }
        } catch (err) {
            console.error(`User ${u.id} Fetch error:`, err.message);
        }
    }
    process.exit(0);
}

testAll();
