const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function check() {
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(path.join(__dirname, 'test.db')));
    const res = db.exec('SELECT * FROM clients LIMIT 1');
    if (res[0]) {
        console.log('CLIENT COLUMNS:', res[0].columns);
        console.log('FIRST CLIENT SAMPLE:', JSON.stringify(res[0].values[0]));
    }
}
check();
