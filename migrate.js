const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function migrate() {
    const SQL = await initSqlJs();
    const dbPath = 'C:\\Users\\PC\\AppData\\Roaming\\logicom-desktop\\logicom.db';
    if (!fs.existsSync(dbPath)) {
        console.log("DB not found at " + dbPath);
        return;
    }
    const filebuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(filebuffer);
    
    console.log("Migrating DB...");
    try {
        db.run("ALTER TABLE clients ADD COLUMN trialStatus INTEGER DEFAULT 0");
        console.log("Added trialStatus");
    } catch(e) { console.log("trialStatus maybe already exists: " + e.message); }
    
    try {
        db.run("ALTER TABLE clients ADD COLUMN trialStartDate TEXT");
        console.log("Added trialStartDate");
    } catch(e) { console.log("trialStartDate maybe already exists: " + e.message); }
    
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    console.log("DB Saved.");
    
    const res = db.exec("PRAGMA table_info(clients)");
    console.log(JSON.stringify(res, null, 2));
}

migrate();
