const db = require('../backend/config/database');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: '../backend/.env' });

async function testUpdate() {
  try {
    const [rows] = await db.execute('SELECT * FROM users LIMIT 1');
    if (rows.length === 0) { console.log('No users found'); return; }
    const user = rows[0];
    
    // update
    await db.execute(
      'UPDATE users SET full_name = ?, phone = ?, faculty = ?, major = ? WHERE id = ?',
      ['Test User', '1234567890', 'Science', 'CS', user.id]
    );
    console.log('Update successful');
  } catch (error) {
    console.error('Update failed. Exact error:', error);
  } finally {
    process.exit();
  }
}
testUpdate();
