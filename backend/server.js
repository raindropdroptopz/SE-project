const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/photo/slips', express.static(path.join(__dirname, '../frontend/uploads/receipts')));

// Import routes
const authRoutes = require('./auth/auth');
const bookingRoutes = require('./routes/bookings');
const equipmentRoutes = require('./routes/equipment');
const adminRoutes = require('./routes/admin');

// API Routes
app.use('/api', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/admin', adminRoutes);

// HTML page routes
const pages = [
    'index', 'login', 'register', 'resetpass', 'forgot-password', 'profile',
    'calendar', 'items', 'item-detail', 'sportarea',
    'court-booking', 'admin-dashboard', 'bookings'
];

pages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
        res.sendFile(path.join(__dirname, '../frontend', `${page}.html`));
    });
});

// Admin pages
app.get('/admin/users', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'admin', 'users.html'));
});

app.get('/admin/bookings', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'admin', 'bookings.html'));
});

app.get('/admin/equipment', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'admin', 'equipment.html'));
});

// Payment pages
app.get('/Payment/confirm', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'Payment', 'confirm.html'));
});

// Default route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).send('404 - Page Not Found');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('==============================================');
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log('==============================================');
    console.log('📌 หน้าสำคัญ:');
    console.log(`   - หน้าแรก: http://localhost:${PORT}/index.html`);
    console.log(`   - Login: http://localhost:${PORT}/login.html`);
    console.log(`   - Register: http://localhost:${PORT}/register.html`);
    console.log(`   - Admin Dashboard: http://localhost:${PORT}/admin-dashboard.html`);
    console.log('==============================================');
});

