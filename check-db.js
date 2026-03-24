const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:\\Users\\PC\\AppData\\Roaming\\logicom-desktop\\logicom.db');

db.serialize(() => {
  db.all('SELECT count(*) as count FROM options', (err, rows) => {
    console.log('Options count:', rows);
  });
  db.all('SELECT count(*) as count FROM activities', (err, rows) => {
    console.log('Activities count:', rows);
  });
  db.all('SELECT count(*) as count FROM clients', (err, rows) => {
    console.log('Clients count:', rows);
  });
});
