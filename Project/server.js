// ----------------- ส่วน import และสร้าง app -----------------
const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // สำหรับรับข้อมูลจาก Form

// ----------------- ส่วนตั้งค่าฐานข้อมูล -----------------
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: ''
};
const dbName = 'se_project';

// ----------------- 1. เชื่อมต่อเพื่อสร้าง DB -----------------
const dbInit = mysql.createConnection(dbConfig);
dbInit.connect((err) => {
    if (err) {
        console.error('เชื่อมต่อ MySQL (Init) ไม่สำเร็จ:', err);
        return;
    }
    
    // สร้างฐานข้อมูลถ้ายังไม่มี
    dbInit.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``, (err) => {
        if (err) {
            console.error('สร้างฐานข้อมูลไม่สำเร็จ:', err);
            dbInit.end();
            return;
        }
        console.log('ตรวจสอบ/สร้างฐานข้อมูล se_project สำเร็จ');
        dbInit.end(); // ปิดการเชื่อมต่อเริ่มต้น

        // ----------------- 2. เชื่อมต่อเข้า DB จริง -----------------
        const db = mysql.createConnection({
            ...dbConfig,
            database: dbName
        });

        db.connect((err) => {
            if (err) {
                console.error('เชื่อมต่อฐานข้อมูล se_project ล้มเหลว:', err);
                return;
            }
            console.log('เชื่อมต่อฐานข้อมูล se_project สำเร็จ');

            // ----------------- 3. สร้างตาราง -----------------
            // (ใช้ Schema ใหม่ที่คุณให้มา + เพิ่ม UNIQUE ให้อีกช่อง)
            const createTableQuery = `
                CREATE TABLE IF NOT EXISTS users (
                    id int(11) NOT NULL AUTO_INCREMENT,
                    email varchar(255) NOT NULL,
                    password varchar(255) NOT NULL,
                    identificationNumber varchar(255) NOT NULL,
                    userType varchar(50) NOT NULL,
                    registration_date timestamp NOT NULL DEFAULT current_timestamp(),
                    PRIMARY KEY (id),
                    UNIQUE KEY email (email),
                    UNIQUE KEY identificationNumber (identificationNumber) 
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `;
            // หมายเหตุ: ผมเพิ่ม UNIQUE KEY (identificationNumber) เพื่อให้การเช็ค "ชื่อผู้ใช้ซ้ำ" (ER_DUP_ENTRY) ทำงานได้ถูกต้อง
            
            db.query(createTableQuery, (err, result) => {
                if (err) {
                    console.error('สร้าง/ตรวจสอบตาราง users ไม่สำเร็จ:', err);
                } else {
                    console.log('ตรวจสอบ/สร้างตาราง users สำเร็จ');
                }
            });

            // ----------------- 4. กำหนด Routes (ทั้งหมดไว้ที่นี่) -----------------
            
            // Endpoint สำหรับ สมัครสมาชิก (Form Submit)
            app.post('/register', (req, res) => {
                // รับข้อมูลทั้งหมดจาก Form
                const { email, password, identificationNumber, userType } = req.body;

                // *** คำเตือน: ควร Hash รหัสผ่านก่อนเก็บ ***

                const sql = 'INSERT INTO users (email, password, identificationNumber, userType) VALUES (?, ?, ?, ?)';
                
                db.query(sql, [email, password, identificationNumber, userType], (err, result) => {
                    if (err) {
                        if (err.code === 'ER_DUP_ENTRY') {
                            console.log('สมัครไม่สำเร็จ: Email หรือ รหัสประจำตัว ซ้ำ');
                            // ส่งกลับไปหน้า register พร้อม query string บอก error
                            return res.redirect('/register?error=duplicate');
                        }
                        console.error('Database error:', err);
                        return res.redirect('/register?error=server');
                    }
                    
                    console.log('สมัครสมาชิกสำเร็จ!');
                    res.redirect('/login'); // สำเร็จแล้วไปหน้า login
                });
            });

            // Endpoint สำหรับ Login (Form Submit)
            // (คุณต้องสร้างหน้า login.html ที่มี <form action="/login" method="POST"> ด้วย)
            app.post('/login', (req, res) => {
                // สมมติว่าหน้า login ใช้ name="identificationNumber" และ name="password"
                const { identificationNumber, password } = req.body; 
                
                const sql = 'SELECT * FROM users WHERE identificationNumber = ? AND password = ?';
                
                db.query(sql, [identificationNumber, password], (err, results) => {
                    if (err) {
                        console.error('Login error:', err);
                        return res.redirect('/login?error=server');
                    }
                    if (results.length > 0) {
                        console.log('Login สำเร็จ!');
                        // (ในอนาคต: ต้องสร้าง Session/Cookie ที่นี่)
                        res.redirect('/index.html?login=success');
                    } else {
                        console.log('Login ล้มเหลว: รหัสผิด');
                        res.redirect('/login?error=invalid');
                    }
                });
            });

            // Endpoint สำหรับเสิร์ฟหน้า HTML
            app.get('/register', (req, res) => {
                res.sendFile(path.join(__dirname, 'register.html'));
            });

            app.get('/index.html', (req, res) => {
                // (ต้องมีไฟล์ index.html อยู่ในโฟลเดอร์เดียวกันด้วย)
                res.sendFile(path.join(__dirname, 'index.html'));
            });

            app.get('/login', (req, res) => {
                res.sendFile(path.join(__dirname, 'login.html'));
            });

            // (หน้า Dashboard ตัวอย่าง หลัง login สำเร็จ)
            app.get('/dashboard', (req, res) => {
                res.send('<h1>ยินดีต้อนรับ! เข้าสู่ระบบสำเร็จ</h1>');
            });

            // หน้าแรก
            app.get('/', (req, res) => {
                res.redirect('/register');
            });

            // ----------------- 5. เริ่ม Server (ครั้งเดียว!) -----------------
            app.listen(3000, () => {
                console.log('==============================================');
                console.log('Server started on port 3000');
                console.log('ทดสอบโดยการเข้า http://localhost:3000/register');
                console.log('==============================================');
            });

        }); // จบ db.connect
    }); // จบ dbInit.query
}); // จบ dbInit.connect