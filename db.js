const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { ipcMain, app } = require('electron');

let db;

function safeLog(...args) {
    try {
        console.log(...args);
    } catch (e) {
        // Silently fail if pipe is broken
    }
}

function initDB() {
    // Connect to SQLite DB
    const dbPath = path.join(app.getPath('userData'), 'logicom.db');
    db = new sqlite3.Database(dbPath);

    safeLog('Database path:', dbPath);

    db.serialize(() => {
        db.run(`
      CREATE TABLE IF NOT EXISTS options (
        id INTEGER PRIMARY KEY,
        name TEXT,
        price INTEGER
      )
    `);

        db.run(`
      CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        icon TEXT,
        subtitle TEXT,
        cat INTEGER,
        note TEXT,
        mandatory TEXT,
        optional TEXT
      )
    `);

        db.run(`
      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        phone TEXT,
        brand TEXT,
        potential INTEGER,
        address TEXT,
        source TEXT,
        options TEXT,
        note TEXT,
        installer TEXT,
        paymentStatus TEXT,
        paymentMode TEXT,
        finalState TEXT,
        noPurchaseReason TEXT,
        created_at TEXT
      )
    `, () => {
        db.run("ALTER TABLE clients ADD COLUMN installer TEXT", () => {});
        db.run("ALTER TABLE clients ADD COLUMN paymentStatus TEXT", () => {});
        db.run("ALTER TABLE clients ADD COLUMN paymentMode TEXT", () => {});
        db.run("ALTER TABLE clients ADD COLUMN finalState TEXT", () => {});
        db.run("ALTER TABLE clients ADD COLUMN noPurchaseReason TEXT", () => {});
        db.run("ALTER TABLE clients ADD COLUMN created_at TEXT", () => {});
    });

        db.run(`
      CREATE TABLE IF NOT EXISTS materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        stock INTEGER,
        price INTEGER,
        note TEXT
      )
    `);
    });
}

function registerIpcHandlers() {
    // Option Operations
    ipcMain.handle('get-options', () => {
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM options', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    });

    ipcMain.handle('get-activities', () => {
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM activities', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    });

    ipcMain.handle('get-clients', () => {
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM clients', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    });

    ipcMain.handle('get-materials', () => {
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM materials', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    });

    function saveAll(event, data) {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION', (err) => {
                    if (err) {
                        safeLog('Transaction Begin Error:', err);
                        return reject(err);
                    }
                });

                // 1. Save Options
                if (data.options) {
                    const stmtOpt = db.prepare('INSERT OR REPLACE INTO options (id, name, price) VALUES (?, ?, ?)');
                    for (const opt of data.options) {
                        stmtOpt.run(opt.id, opt.name, opt.price);
                    }
                    stmtOpt.finalize();
                }

                // 2. Save Activities
                if (data.activities) {
                    const stmtAct = db.prepare('INSERT OR REPLACE INTO activities (id, name, icon, subtitle, cat, note, mandatory, optional) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
                    for (const act of data.activities) {
                        stmtAct.run(act.id, act.name, act.icon, act.subtitle, act.cat, act.note, JSON.stringify(act.mandatory), JSON.stringify(act.optional));
                    }
                    stmtAct.finalize();
                }

                // 3. Save Clients
                if (data.clients) {
                    const stmtCl = db.prepare('INSERT OR REPLACE INTO clients (id, name, phone, brand, potential, address, source, options, note, installer, paymentStatus, paymentMode, finalState, noPurchaseReason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                    for (const c of data.clients) {
                        stmtCl.run(c.id, c.name, c.phone, c.brand, c.potential ? 1 : 0, c.address, c.source, JSON.stringify(c.options || []), c.note || '', c.installer || '', c.paymentStatus || '', c.paymentMode || '', c.finalState || '', c.noPurchaseReason || '', c.created_at || '');
                    }
                    stmtCl.finalize();
                }

                // 4. Save Materials
                if (data.materials) {
                    const stmtMat = db.prepare('INSERT OR REPLACE INTO materials (id, name, stock, price, note) VALUES (?, ?, ?, ?, ?)');
                    for (const m of data.materials) {
                        stmtMat.run(m.id, m.name, m.stock, m.price, m.note);
                    }
                    stmtMat.finalize();
                }

                db.run('COMMIT', (err) => {
                    if (err) {
                        safeLog('Transaction Commit Error:', err);
                        db.run('ROLLBACK');
                        reject(err);
                    } else {
                        safeLog('Successfully saved all data');
                        resolve(true);
                    }
                });
            });
        });
    }

    ipcMain.handle('save-all', (event, data) => saveAll(event, data));

    // Keep old ones for compatibility but they are now legacy
    ipcMain.handle('save-opts', (event, optionsArray) => saveAll(event, { options: optionsArray }));
    ipcMain.handle('save-acts', (event, activitiesArray) => saveAll(event, { activities: activitiesArray }));
    ipcMain.handle('save-clients', (event, clientsArray) => saveAll(event, { clients: clientsArray }));
    ipcMain.handle('save-materials', (event, materialsArray) => saveAll(event, { materials: materialsArray }));
}

module.exports = { initDB, registerIpcHandlers };
