const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname);
const rootDir = path.join(__dirname, '..');

const filesToProcess = [
    path.join(rootDir, 'admin-dashboard.html'),
    path.join(dir, 'bookings.html'),
    path.join(dir, 'calendar.html'),
    path.join(dir, 'courts.html'),
    path.join(dir, 'equipment.html'),
    path.join(dir, 'finance.html'),
    path.join(dir, 'receipts.html'),
    path.join(dir, 'users.html')
];

let changedCount = 0;

filesToProcess.forEach(filePath => {
    if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        let original = content;

        // 1. Remove borrow reports link from sidebar
        content = content.replace(/<li><a href="\/admin\/borrow-reports\.html(?:".*?>|[^>]*?>)(?:<i.*?>.*?<\/i>)?\s*รายงานการยืม.*?<\/a><\/li>/gi, '');
        // simpler fallback if regex doesn't match perfectly
        content = content.replace(/<li><a href="\/admin\/borrow-reports\.html".*?<\/li>/gi, '');

        // 2. Rename Bookings to Court & Equipment Bookings
        content = content.replace(/>\s*<i class="bi bi-calendar-check"><\/i>\s*การจองทั้งหมด\s*<\/a>/gi, '><i class="bi bi-calendar-check"></i> การจองสนาม &amp; อุปกรณ์</a>');

        // 3. Special changes for bookings.html header and title
        if (filePath.endsWith('bookings.html')) {
            content = content.replace(/<title>การจองทั้งหมด/gi, '<title>การจองสนาม & อุปกรณ์');
            content = content.replace(/<h1><i class="bi bi-calendar-check me-2"><\/i>การจองทั้งหมด<\/h1>/gi, '<h1><i class="bi bi-calendar-check me-2"></i>การจองสนาม &amp; อุปกรณ์</h1>');
            content = content.replace(/<p style="margin:0; color:#6c7293; font-size:0.9rem;">จัดการและตรวจสอบการจองสนามกีฬาทั้งหมด<\/p>/gi, '<p style="margin:0; color:#6c7293; font-size:0.9rem;">จัดการและตรวจสอบประวัติการจองและยืมอุปกรณ์ทั้งหมด</p>');
            
            // Just in case the exact active path isn't hitting my regex above
            content = content.replace(/การจองทั้งหมด/g, 'การจองสนาม & อุปกรณ์');
            
            // Fix any weird replacements where the title might look broken
            content = content.replace(/การจองสนาม & อุปกรณ์ - Admin Dashboard/g, 'การจองสนาม & อุปกรณ์ - Admin Dashboard');
        }

        if (content !== original) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`Updated successfully: ${path.basename(filePath)}`);
            changedCount++;
        }
    }
});

console.log(`Total files updated: ${changedCount}`);
process.exit(0);
