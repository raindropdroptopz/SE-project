// สคริปต์สำหรับสร้าง hash password
const bcrypt = require('bcryptjs');

// เปลี่ยนรหัสผ่านที่ต้องการ hash ตรงนี้
const passwords = ['admin123', 'test123', '123456'];

async function hashPasswords() {
    console.log('='.repeat(60));
    console.log('🔐 Password Hashing Result:');
    console.log('='.repeat(60));

    for (const password of passwords) {
        const hash = await bcrypt.hash(password, 10);
        console.log(`\nPassword: "${password}"`);
        console.log(`Hash: ${hash}`);
        console.log('-'.repeat(60));
    }
}

hashPasswords();
