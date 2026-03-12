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
        
        // Courts
        await db.execute("UPDATE courts SET image_url = '/photo/football_court_hq_1770146504283.png' WHERE name LIKE '%ฟุตบอล%'");
        await db.execute("UPDATE courts SET image_url = '/photo/basketball_court_hq_1770146518588.png' WHERE name LIKE '%บาสเกต%'");
        await db.execute("UPDATE courts SET image_url = '/photo/tennis_court_hq_1770146533333.png' WHERE name LIKE '%เทนนิส%'");
        await db.execute("UPDATE courts SET image_url = '/photo/badminton_court_hq_1770146551487.png' WHERE name LIKE '%แบดมินตัน%'");
        await db.execute("UPDATE courts SET image_url = '/photo/volleyball.png' WHERE name LIKE '%วอลเลย์%'");
        
        // Equipments
        await db.execute("UPDATE equipment SET image_url = '/photo/basketball.jpg' WHERE name LIKE '%บาสเกตบอล%'");
        await db.execute("UPDATE equipment SET image_url = '/photo/tennis.jpg' WHERE name LIKE '%เทนนิส%' OR name LIKE '%ลูกเทนนิส%'");
        await db.execute("UPDATE equipment SET image_url = '/photo/badminton.jpg' WHERE name LIKE '%แบดมินตัน%' OR name LIKE '%ลูกขนไก่%'");
        await db.execute("UPDATE equipment SET image_url = '/photo/volleyball.png' WHERE name LIKE '%วอลเลย์%'");
        await db.execute("UPDATE equipment SET image_url = '/photo/football.png' WHERE name LIKE '%ฟุตบอล%'");
        await db.execute("UPDATE equipment SET image_url = '/photo/training_cones.png' WHERE name LIKE '%กรวย%'");
        await db.execute("UPDATE equipment SET image_url = '/photo/QR.png' WHERE name LIKE '%นกหวีด%'"); // fallback

        console.log("Images updated!");
    } catch (e) {
        console.error("SQL Error:", e.message);
    }
    process.exit(0);
}
run();