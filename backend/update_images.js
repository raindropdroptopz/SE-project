const db = require('./config/database');

(async () => {
    try {
        await db.execute("UPDATE courts SET image_url = '/photo/football_court_hq_1770146504283.png' WHERE id = 1");
        await db.execute("UPDATE courts SET image_url = '/photo/basketball_court_hq_1770146518588.png' WHERE id = 2");
        await db.execute("UPDATE courts SET image_url = '/photo/tennis_court_hq_1770146533333.png' WHERE id = 3");
        await db.execute("UPDATE courts SET image_url = '/photo/badminton_court_hq_1770146551487.png' WHERE id = 4");
        // For volleyball, I will check the original URL from the HTML.
        // It was: "https://img.freepik.com/premium-photo/gym-volleyball-game_1142512-34988.jpg"
        await db.execute("UPDATE courts SET image_url = 'https://img.freepik.com/premium-photo/gym-volleyball-game_1142512-34988.jpg' WHERE id = 6");

        const [rows] = await db.execute('SELECT id, name, image_url FROM courts');
        console.table(rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
})();
