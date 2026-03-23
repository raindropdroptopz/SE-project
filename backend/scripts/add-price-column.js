const db = require('./config/database');

(async () => {
    try {
        console.log('Checking if price column exists in courts table...');
        const [columns] = await db.execute("SHOW COLUMNS FROM courts LIKE 'price'");

        if (columns.length === 0) {
            console.log('Price column not found. Adding it now...');
            await db.execute("ALTER TABLE courts ADD COLUMN price INT DEFAULT 300");
            console.log('Successfully added price column to courts table.');
        } else {
            console.log('Price column already exists.');
        }
    } catch (error) {
        console.error('Error adding column:', error);
    } finally {
        process.exit(0);
    }
})();
