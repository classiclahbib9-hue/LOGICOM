const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function check(dbPath) {
    const SQL = await initSqlJs({
        locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
    });
    if (fs.existsSync(dbPath)) {
        const filebuffer = fs.readFileSync(dbPath);
        const db = new SQL.Database(filebuffer);
        const res = db.exec('SELECT COUNT(*) FROM clients');
        console.log(`DB Path: ${dbPath}`);
        console.log(`Client Count: ${res[0].values[0][0]}`);
    } else {
        console.log(`DB Path: ${dbPath} NOT FOUND`);
    }
}

check('c:/Users/PC/software/LOGICOM/test.db').then(() => {
    check('C:/Users/PC/Desktop/test-db');
});
