const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('test.db', (err) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log('Connected to the database.');
        process.exit(0);
    }
});
