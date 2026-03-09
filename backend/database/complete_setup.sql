-- ===============================================
-- คำสั่ง SQL สำหรับ Payap Sports Database
-- รัน 1 คำสั่งต่อครั้งใน phpMyAdmin (แท็บ SQL)
-- ===============================================

-- 1. สร้าง Database
CREATE DATABASE IF NOT EXISTS payap_sports CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE payap_sports;

-- ===============================================
-- 2. ตาราง users (สำหรับ /api/register, /api/login, /api/profile)
-- ===============================================
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    student_id VARCHAR(20),
    phone VARCHAR(20),
    faculty VARCHAR(255),
    major VARCHAR(255),
    user_type ENUM('student', 'staff', 'external') DEFAULT 'student',
    role ENUM('user', 'admin') DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===============================================
-- 3. ตาราง courts (สำหรับ /api/bookings/courts)
-- ===============================================
CREATE TABLE IF NOT EXISTS courts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    capacity INT DEFAULT 10,
    open_time TIME DEFAULT '06:00:00',
    close_time TIME DEFAULT '20:00:00',
    image_url VARCHAR(500),
    status ENUM('available', 'unavailable', 'maintenance') DEFAULT 'available',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===============================================
-- 4. ตาราง bookings (สำหรับ /api/bookings - GET/POST)
-- ===============================================
CREATE TABLE IF NOT EXISTS bookings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    court_id INT NOT NULL,
    booking_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    players INT DEFAULT 1,
    note TEXT,
    status ENUM('pending', 'confirmed', 'cancelled', 'completed') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===============================================
-- 5. ตาราง equipment (สำหรับ /api/equipment - GET)
-- ===============================================
CREATE TABLE IF NOT EXISTS equipment (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    stock INT DEFAULT 0,
    available INT DEFAULT 0,
    max_borrow_days INT DEFAULT 1,
    image_url VARCHAR(500),
    status ENUM('available', 'low', 'out') DEFAULT 'available',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===============================================
-- 6. ตาราง equipment_bookings (สำหรับ /api/equipment/borrow - POST)
-- ===============================================
CREATE TABLE IF NOT EXISTS equipment_bookings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    equipment_id INT NOT NULL,
    quantity INT DEFAULT 1,
    borrow_date DATE NOT NULL,
    return_date DATE,
    actual_return_date DATE,
    status ENUM('pending', 'borrowed', 'returned', 'overdue') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===============================================
-- 7. เพิ่มข้อมูลเริ่มต้น: สนามกีฬา
-- ===============================================
INSERT INTO courts (name, description, capacity, image_url) VALUES
('สนามฟุตบอลและลู่วิ่ง', 'สำหรับกิจกรรมฟุตบอลและการฝึกซ้อมวิ่งรอบสนาม รองรับได้ทั้งทีมและบุคคล', 22, '/photo/football.jpg'),
('สนามบาสเกตบอล', 'สนามบาสเกตบอลในร่มสำหรับทั้งการฝึกซ้อมและแข่งขัน พื้นสนามมาตรฐาน', 10, '/photo/bask.png'),
('สนามเทนนิส', 'สนามเทนนิสมาตรฐานพร้อมอุปกรณ์ให้เช่าสำหรับผู้ที่ต้องการเล่น', 4, '/photo/tennis.jpg'),
('สนามแบดมินตันและวอลเลย์บอล', 'สามารถเลือกใช้ได้ทั้งสองประเภทกีฬา มีตาข่ายและเสาพร้อมใช้งาน', 12, '/photo/badminton.jpg');

-- ===============================================
-- 8. เพิ่มข้อมูลเริ่มต้น: อุปกรณ์กีฬา
-- ===============================================
INSERT INTO equipment (name, description, category, stock, available, image_url, status) VALUES
('ลูกฟุตบอล', 'ลูกฟุตบอล ขนาด 5 มาตรฐาน FIFA สำหรับการฝึกซ้อมและแข่งขัน', 'ลูกบอล', 15, 15, '/photo/football.png', 'available'),
('ลูกบาสเกตบอล', 'ลูกบาสเกตบอล ขนาด 7 สำหรับเล่นในสนามในร่มและกลางแจ้ง', 'ลูกบอล', 10, 10, '/photo/basketball.jpg', 'available'),
('ไม้เทนนิส', 'ไม้เทนนิสสำหรับผู้เริ่มต้น พร้อมลูกเทนนิส 1 กระป๋อง', 'ไม้และแร็กเก็ต', 2, 2, '/photo/tennis.jpg', 'low'),
('ไม้แบดมินตัน', 'ไม้แบดมินตันพร้อมลูกขนไก่ 1 หลอดสำหรับ 2 ท่าน', 'ไม้และแร็กเก็ต', 8, 8, '/photo/badminton.jpg', 'available'),
('ลูกวอลเลย์บอล', 'ลูกวอลเลย์บอลมาตรฐาน สำหรับเล่นในร่มและชายหาด', 'ลูกบอล', 6, 6, '/photo/volleyball.png', 'available'),
('ชุดกรวยฝึกซ้อม', 'ชุดกรวย 10 ชิ้น สำหรับการฝึกซ้อมความคล่องตัว', 'อุปกรณ์ฝึกซ้อม', 4, 4, '/photo/training_cones.png', 'available');

-- ===============================================
-- 9. เพิ่มข้อมูลเริ่มต้น: Admin User
-- Password: admin123 (hashed ด้วย bcrypt)
-- ===============================================
INSERT INTO users (email, password, full_name, student_id, user_type, role) VALUES
('admin@payap.ac.th', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'ผู้ดูแลระบบ', 'ADMIN001', 'staff', 'admin');

-- ===============================================
-- เสร็จสิ้น! ตรวจสอบตารางทั้งหมด
-- ===============================================
SHOW TABLES;
