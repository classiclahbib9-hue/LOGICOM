const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'logicom-desktop', 'logicom.db');
console.log('Testing DB at:', dbPath);

const db = new sqlite3.Database(dbPath);

const data = {
  options: [{ id: 999, name: 'Test Option', price: 100 }],
  activities: [],
  clients: [],
  materials: [{ id: 999, name: 'Test Material', stock: 10, price: 50, note: 'Test note' }]
};

db.serialize(() => {
  db.run('BEGIN TRANSACTION', (err) => { if (err) { console.error('Begin Error:', err); process.exit(1); } });

  const stmtOpt = db.prepare('INSERT OR REPLACE INTO options (id, name, price) VALUES (?, ?, ?)');
  for (const opt of data.options) {
    stmtOpt.run(opt.id, opt.name, opt.price);
  }
  stmtOpt.finalize();

  const stmtMat = db.prepare('INSERT OR REPLACE INTO materials (id, name, stock, price, note) VALUES (?, ?, ?, ?, ?)');
  for (const m of data.materials) {
    stmtMat.run(m.id, m.name, m.stock, m.price, m.note);
  }
  stmtMat.finalize();

  db.run('COMMIT', (err) => {
    if (err) {
      console.error('Commit Error:', err);
      db.run('ROLLBACK');
      process.exit(1);
    } else {
      console.log('Success!');
      process.exit(0);
    }
  });
});
