// ----------------- ส่วน import และสร้าง app -----------------
const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// สร้างฐานข้อมูล se_project อัตโนมัติถ้ายังไม่มี
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: ''
};
const dbName = 'se_project';

// เชื่อมต่อโดยไม่ระบุ database ก่อน
const dbInit = mysql.createConnection(dbConfig);
dbInit.connect((err) => {
    if (err) {
        console.error('เชื่อมต่อ MySQL ไม่สำเร็จ:', err);
        return;
    }
    // สร้างฐานข้อมูลถ้ายังไม่มี
    dbInit.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`` , (err) => {
        if (err) {
            console.error('สร้างฐานข้อมูลไม่สำเร็จ:', err);
            dbInit.end();
            return;
        }
        console.log('ตรวจสอบ/สร้างฐานข้อมูล se_project สำเร็จ');
        dbInit.end();

        // เชื่อมต่อใหม่โดยระบุ database
        const db = mysql.createConnection({
            ...dbConfig,
            database: dbName
        });

        db.connect((err) => {
            if (err) {
                console.error('เชื่อมต่อฐานข้อมูลล้มเหลว:', err);
                return;
            }
            console.log('เชื่อมต่อฐานข้อมูลสำเร็จ');

            // สร้างตาราง users ถ้ายังไม่มี
            const createTableQuery = `
                CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(50) NOT NULL UNIQUE,
                    password VARCHAR(255) NOT NULL,
                    email VARCHAR(100)
                )
            `;
            db.query(createTableQuery, (err, result) => {
                if (err) {
                    console.error('สร้างตาราง users ไม่สำเร็จ:', err);
                } else {
                    console.log('ตรวจสอบ/สร้างตาราง users สำเร็จ');
                }
            });

            // API สำหรับ login
            app.post('/api/login', (req, res) => {
                const { username, password } = req.body;
                const sql = 'SELECT * FROM users WHERE username = ? AND password = ?';
                db.query(sql, [username, password], (err, results) => {
                    if (err) {
                        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
                    }
                    if (results.length > 0) {
                        res.json({ success: true });
                    } else {
                        res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
                    }
                });
            });

            // API สำหรับสมัครสมาชิก
            app.post('/api/register', (req, res) => {
                const { email, password, identificationNumber, userType } = req.body;
                // ใช้ identificationNumber เป็น username
                const sql = 'INSERT INTO users (username, password, email) VALUES (?, ?, ?)';
                db.query(sql, [identificationNumber, password, email], (err, result) => {
                    if (err) {
                        if (err.code === 'ER_DUP_ENTRY') {
                            return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' });
                        }
                        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
                    }
                    res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ' });
                });
            });

            app.listen(3000, () => {
                console.log('Server started on port 3000');
            });
        });
    });
});
