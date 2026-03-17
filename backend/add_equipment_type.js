const db = require('./config/database');
async function setupType() {
    try {
        console.log("Adding type column to equipment table...");
        await db.query(`ALTER TABLE equipment ADD COLUMN type ENUM('borrow', 'sell') DEFAULT 'borrow' AFTER category`);
        console.log("Added type column!");
        
        console.log("Inserting Badminton Shuttlecocks...");
        await db.query(`
            INSERT INTO equipment (name, description, category, type, stock, available, price, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, ['ลูกแบดมินตัน (ลูกขนไก่)', 'ขายลูกแบดมินตันเกรดแข่งขัน หลอดละ 12 ลูก', 'badminton', 'sell', 50, 50, 300, 'available']);
        console.log("Added Shuttlecocks!");
        
        process.exit();
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log("Column 'type' already exists.");
            process.exit();
        }
        console.error(e);
        process.exit(1);
    }
}
setupType();
