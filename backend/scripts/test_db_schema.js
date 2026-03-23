const db = require('./config/database');
async function checkSchema() {
    try {
        const [rows] = await db.query('DESCRIBE equipment');
        console.log("Equipment Table Schema:");
        console.table(rows);
        process.exit();
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkSchema();
