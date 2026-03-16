const db = require('../backend/config/database');

async function syncPayments() {
    try {
        console.log('Connected via project config');

        // Find bookings that DON'T have a payment record
        const [bookings] = await db.execute(`
            SELECT b.*, c.price as court_price 
            FROM bookings b
            JOIN courts c ON b.court_id = c.id
            LEFT JOIN payments p ON b.id = p.booking_id
            WHERE p.id IS NULL
        `);

        console.log(`Found ${bookings.length} bookings without payment records.`);

        for (const b of bookings) {
            // Calculate hours
            const startStr = b.start_time.toString();
            const endStr = b.end_time.toString();
            
            const startParts = startStr.split(':').map(Number);
            const endParts = endStr.split(':').map(Number);
            const startMins = startParts[0] * 60 + (startParts[1] || 0);
            const endMins = endParts[0] * 60 + (endParts[1] || 0);
            const courtHours = parseFloat(((endMins - startMins) / 60).toFixed(1));
            const courtSubtotal = Math.round(b.court_price * courtHours);
            const totalAmount = courtSubtotal;

            let paymentStatus = 'pending';
            if (b.status === 'confirmed' || b.status === 'completed') paymentStatus = 'verified';

            console.log(`Syncing Booking #${b.id}: Hours=${courtHours}, Subtotal=${courtSubtotal}, Status=${paymentStatus}`);

            await db.execute(`
                INSERT INTO payments (booking_id, user_id, court_price_rate, court_hours, court_subtotal, total_amount, payment_slip, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                b.id, b.user_id, b.court_price, courtHours, courtSubtotal, totalAmount, b.payment_slip, paymentStatus, b.created_at
            ]);
        }

        console.log('Sync complete!');
        process.exit(0);

    } catch (error) {
        console.error('Sync failed:', error);
        process.exit(1);
    }
}

syncPayments();
