const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { ipcMain, app, Notification } = require('electron');

let db;
let SQL;
const dbPath = path.join(__dirname, 'test.db');

function safeLog(...args) {} // Logging disabled

async function initDB() {
    SQL = await initSqlJs({
        locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
    });
    if (fs.existsSync(dbPath)) {
        const filebuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(filebuffer);
    } else {
        db = new SQL.Database();
    }

    try {
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

        // ═══════════════════════════ RAPPELS & CLIENTS ═══════════════════════════
        db.run(`
          CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT, phone TEXT, brand TEXT, potential INTEGER, address TEXT, source TEXT, 
            options TEXT, note TEXT, installer TEXT, material TEXT, paymentStatus TEXT, 
            paymentMode TEXT, finalState TEXT, noPurchaseReason TEXT, created_at TEXT, 
            called INTEGER DEFAULT 0, dateDernierRappel TEXT,
            trialStatus INTEGER DEFAULT 0, trialStartDate TEXT, trialPeriod INTEGER DEFAULT 15,
            category TEXT DEFAULT 'Nouveau',
            added_by TEXT
          )
        `);

        // Ignored migrations (wrapped in try/catch for sql.js)
        try { db.run("ALTER TABLE clients ADD COLUMN installer TEXT"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN material TEXT"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN paymentStatus TEXT"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN paymentMode TEXT"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN finalState TEXT"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN noPurchaseReason TEXT"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN created_at TEXT"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN called INTEGER DEFAULT 0"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN dateDernierRappel TEXT"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN trialStatus INTEGER DEFAULT 0"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN trialStartDate TEXT"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN trialPeriod INTEGER DEFAULT 15"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN category TEXT DEFAULT 'Nouveau'"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN added_by TEXT"); } catch(e){}

        db.run(`
          CREATE TABLE IF NOT EXISTS materials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            stock INTEGER,
            price INTEGER,
            note TEXT
          )
        `);
        
        saveToFile();
    } catch (err) {
        // Silently handle schema issues
    }
}

function saveToFile() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
}

function registerIpcHandlers() {
    ipcMain.handle('get-options', () => {
        const res = db.exec('SELECT * FROM options');
        return formatResult(res);
    });

    ipcMain.handle('get-activities', () => {
        const res = db.exec('SELECT * FROM activities');
        return formatResult(res);
    });

    ipcMain.handle('get-clients', () => {
        const res = db.exec('SELECT * FROM clients');
        return formatResult(res);
    });

    ipcMain.handle('get-materials', () => {
        const res = db.exec('SELECT * FROM materials');
        return formatResult(res);
    });

    function formatResult(res) {
        if (!res || res.length === 0) return [];
        const columns = res[0].columns;
        return res[0].values.map(row => {
            const obj = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            return obj;
        });
    }

    async function saveAll(event, data) {
        try {
            if (data.options) {
                db.run('DELETE FROM options');
                const stmt = db.prepare('INSERT OR REPLACE INTO options (id, name, price) VALUES (?, ?, ?)');
                for (const opt of data.options) {
                    stmt.run([opt.id, opt.name, opt.price]);
                }
                stmt.free();
            }

            if (data.activities) {
                db.run('DELETE FROM activities');
                const stmt = db.prepare('INSERT OR REPLACE INTO activities (id, name, icon, subtitle, cat, note, mandatory, optional) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
                for (const act of data.activities) {
                    stmt.run([act.id, act.name, act.icon, act.subtitle, act.cat, act.note, JSON.stringify(act.mandatory), JSON.stringify(act.optional)]);
                }
                stmt.free();
            }

            if (data.clients) {
                db.run('DELETE FROM clients');
                const sql = `INSERT OR REPLACE INTO clients (id, name, phone, brand, potential, address, source, options, note, installer, material, paymentStatus, paymentMode, finalState, noPurchaseReason, created_at, called, dateDernierRappel, trialStatus, trialStartDate, trialPeriod, category, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                const stmt = db.prepare(sql);
                for (const c of data.clients) {
                    stmt.run([c.id, c.name, c.phone, c.brand, (c.potential?1:0), c.address, c.source, JSON.stringify(c.options || []), c.note || '', c.installer || '', c.material || 'Non', c.paymentStatus || '', c.paymentMode || '', c.finalState || '', c.noPurchaseReason || '', c.created_at || '', (c.called?1:0), c.dateDernierRappel || '', (c.trialStatus || 0), c.trialStartDate || '', c.trialPeriod || 15, c.category || 'Nouveau', c.added_by || '']);
                }
                stmt.free();
            }

            if (data.materials) {
                db.run('DELETE FROM materials');
                const stmt = db.prepare('INSERT OR REPLACE INTO materials (id, name, stock, price, note) VALUES (?, ?, ?, ?, ?)');
                for (const m of data.materials) {
                    stmt.run([m.id, m.name, m.stock, m.price, m.note]);
                }
                stmt.free();
            }

            saveToFile();
            return true;
        } catch (err) {
            console.error('SQL.JS Save Error:', err);
            throw err;
        }
    }

    ipcMain.handle('save-all', (event, data) => saveAll(event, data));
    ipcMain.handle('save-opts', (event, optionsArray) => saveAll(event, { options: optionsArray }));
    ipcMain.handle('save-acts', (event, activitiesArray) => saveAll(event, { activities: activitiesArray }));
    ipcMain.handle('save-clients', (event, clientsArray) => saveAll(event, { clients: clientsArray }));
    ipcMain.handle('save-materials', (event, materialsArray) => saveAll(event, { materials: materialsArray }));
}

async function addClientManually(clientData) {
    const { BrowserWindow, Notification } = require('electron');
    try {
        const sql = `INSERT INTO clients (name, phone, brand, potential, address, source, options, note, installer, material, paymentStatus, paymentMode, finalState, noPurchaseReason, created_at, called, trialStatus, trialStartDate, trialPeriod, category, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const stmt = db.prepare(sql);
        const now = new Date().toISOString().split('T')[0];
        
        stmt.run([
            clientData.name || 'Nouveau Client',
            clientData.phone || '',
            clientData.brand || '',
            1,
            '',
            'Telegram',
            '[]',
            clientData.note || '',
            'Non',
            'Non',
            'Non',
            '',
            '',
            '',
            now,
            0,
            0,
            '',
            15,
            'Nouveau',
            clientData.addedBy || ''
        ]);
        stmt.free();
        saveToFile();
        
        console.log('Client saved via Telegram bot:', clientData.name);
        
        // Show Native Notification
        if (Notification.isSupported()) {
            new Notification({
                title: 'LOGICOM - Nouveau Client 🔔',
                body: `Un nouveau client "${clientData.name}" vient de s'inscrire via Telegram.`
            }).show();
        }
        
        // Notify all windows to refresh
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('refresh-clients');
        });
    } catch (err) {
        console.error('FAILED to save client via Telegram:', err);
    }
}

module.exports = { initDB, registerIpcHandlers, addClientManually };
