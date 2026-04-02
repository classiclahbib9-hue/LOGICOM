const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function check() {
    const SQL = await initSqlJs();
    const dbPath = path.join(__dirname, 'test.db');
    console.log("Checking DB at " + dbPath);
    if (!fs.existsSync(dbPath)) {
        console.log("DB not found at " + dbPath);
        return;
    }
    const filebuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(filebuffer);
    const res = db.exec("PRAGMA table_info(clients)");
    console.log(JSON.stringify(res, null, 2));
}

check();
