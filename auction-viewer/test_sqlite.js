const sqlite3 = require('sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'database/auction_data.db');
console.log('Opening DB:', dbPath);

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error('DB Open Error:', err);
        process.exit(1);
    }
    console.log('DB Opened successfully');

    db.get('SELECT count(*) as cnt FROM auction_list_cleaned', (err, row) => {
        if (err) {
            console.error('Query Error:', err);
            process.exit(1);
        }
        console.log('Query Result:', row);

        db.close((err) => {
            if (err) console.error('Close Error:', err);
            else console.log('DB Closed');
        });
    });
});
