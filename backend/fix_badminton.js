const db = require('./config/database');

async function fix() {
    try {
        // Show all equipment to find the right item
        const [all] = await db.execute("SELECT id, name, image_url, price, type FROM equipment");
        console.log('All equipment:');
        all.forEach(item => console.log(`  id=${item.id} name="${item.name}" price=${item.price} image="${item.image_url}" type=${item.type}`));

        // Find badminton shuttlecock - look for items with แบด or ลูก
        const badminton = all.filter(item => 
            (item.name || '').includes('แบด') || 
            (item.name || '').toLowerCase().includes('badminton') ||
            (item.name || '').toLowerCase().includes('shuttl') ||
            (item.image_url || '').toLowerCase().includes('batminton') ||
            (item.image_url || '').toLowerCase().includes('badminton')
        );
        
        console.log('\nMatched badminton items:', badminton);

        for (const item of badminton) {
            const [result] = await db.execute(
                "UPDATE equipment SET image_url = ?, price = ? WHERE id = ?",
                ['/photo/BatmintonYonex.jpg', 300, item.id]
            );
            console.log(`Updated id=${item.id} "${item.name}" → affectedRows: ${result.affectedRows}`);
        }
        
        if (badminton.length === 0) {
            console.log('No badminton items found - showing all items above, please check the name');
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

fix();
