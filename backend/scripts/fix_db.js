const db = require('./config/database');

async function fixDb() {
    try {
        console.log("Checking if booking_id exists in equipment_bookings...");
        
        // Check if column exists
        const [columns] = await db.execute("SHOW COLUMNS FROM equipment_bookings LIKE 'booking_id'");
        
        if (columns.length === 0) {
            console.log("Column booking_id not found. Adding it...");
            await db.execute("ALTER TABLE equipment_bookings ADD COLUMN booking_id INT NULL");
            console.log("Column added successfully.");
            
            console.log("Adding foreign key constraint...");
            await db.execute(`
                ALTER TABLE equipment_bookings 
                ADD CONSTRAINT fk_equip_booking 
                FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
            `);
            console.log("Foreign key constraint added successfully.");
        } else {
            console.log("Column booking_id already exists.");
        }
        
    } catch (err) {
        console.error("Error modifying database:", err);
    } finally {
        process.exit(0);
    }
}

fixDb();
