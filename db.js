const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { ipcMain, app, Notification } = require('electron');

let db;
let SQL;
const dbPath = path.join(__dirname, 'test.db');
const backupDir = path.join(__dirname, 'backups');

function safeLog(...args) {} // Logging disabled

function makeBackup() {
    try {
        if (!fs.existsSync(dbPath)) return;
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const dest = path.join(backupDir, `logicom-${ts}.db`);
        fs.copyFileSync(dbPath, dest);
        // Keep only last 10 backups
        const files = fs.readdirSync(backupDir)
            .filter(f => f.endsWith('.db'))
            .map(f => ({ f, t: fs.statSync(path.join(backupDir, f)).mtimeMs }))
            .sort((a, b) => b.t - a.t);
        files.slice(10).forEach(({ f }) => {
            try { fs.unlinkSync(path.join(backupDir, f)); } catch(e) {}
        });
    } catch(e) {
        console.error('[Backup] Failed:', e.message);
    }
}

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

        db.run(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT,
            tabsAccess TEXT
          )
        `);

        // Add default admin if not exists
        try {
            const adminCheck = db.exec('SELECT * FROM users WHERE username = "admin"');
            if (!adminCheck.length || !adminCheck[0].values.length) {
                // By default give admin access to all tabs (0 to 12)
                db.run(`INSERT INTO users (username, password, role, tabsAccess) VALUES ('admin', 'admin', 'Admin', '[0,1,2,3,4,5,6,7,8,9,10,11,12]')`);
            }
        } catch(e) {
            console.error('Failed to create default admin:', e);
        }

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
            added_by TEXT,
            negotiatedPrice INTEGER DEFAULT 0,
            paidAmount INTEGER DEFAULT 0,
            paymentDeadline TEXT,
            autoReminder INTEGER DEFAULT 0,
            reminderSent INTEGER DEFAULT 0
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
        try { db.run("ALTER TABLE clients ADD COLUMN negotiatedPrice INTEGER DEFAULT 0"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN paidAmount INTEGER DEFAULT 0"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN paymentDeadline TEXT"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN autoReminder INTEGER DEFAULT 0"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN telegramChatId TEXT"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN trialOutcome TEXT DEFAULT ''"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN trialLostReason TEXT DEFAULT ''"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN promisedDate TEXT"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN promisedAmount INTEGER DEFAULT 0"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN promisedMethod TEXT"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN promiseNote TEXT"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN installed_at TEXT"); } catch(e){}
        try { db.run("ALTER TABLE clients ADD COLUMN reminderSent INTEGER DEFAULT 0"); } catch(e){}

        db.run(`
          CREATE TABLE IF NOT EXISTS materials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            stock INTEGER,
            price INTEGER,
            note TEXT
          )
        `);

        db.run(`
          CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clientId INTEGER,
            clientName TEXT,
            amount INTEGER,
            date TEXT,
            method TEXT,
            notes TEXT
          )
        `);

        try {
            db.run(`
              CREATE TABLE IF NOT EXISTS pending_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                clientId INTEGER,
                phone TEXT,
                message TEXT,
                channel TEXT,
                status TEXT DEFAULT 'Pending',
                created_at TEXT,
                filePath TEXT
              )
            `);
        } catch(e) {}
        
        saveToFile();
    } catch (err) {
        // Silently handle schema issues
    }
}

function saveToFile() {
    makeBackup();
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

    ipcMain.handle('get-users', () => {
        try {
            const res = db.exec('SELECT * FROM users');
            return formatResult(res);
        } catch(e) { return []; }
    });

    ipcMain.handle('login', (event, { username, password }) => {
        try {
            const stmt = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?');
            stmt.bind([username, password]);
            if (stmt.step()) {
                const user = stmt.getAsObject();
                stmt.free();
                return { success: true, user };
            }
            stmt.free();
            return { success: false, message: 'Identifiants incorrects' };
        } catch(e) { return { success: false, message: 'Erreur DB: ' + e.message }; }
    });

    ipcMain.handle('save-user', (event, user) => {
        try {
            if (user.id) {
                db.run(`UPDATE users SET username=?, password=?, role=?, tabsAccess=? WHERE id=?`, 
                    [user.username, user.password, user.role, JSON.stringify(user.tabsAccess), user.id]);
            } else {
                db.run(`INSERT INTO users (username, password, role, tabsAccess) VALUES (?, ?, ?, ?)`, 
                    [user.username, user.password, user.role, JSON.stringify(user.tabsAccess)]);
            }
            saveToFile();
            return { success: true };
        } catch(e) { return { success: false, message: e.message }; }
    });

    ipcMain.handle('delete-user', (event, id) => {
        try {
            // Empêcher la suppression du compte admin
            const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
            stmt.bind([id]);
            if (stmt.step()) {
                const user = stmt.getAsObject();
                stmt.free();
                if (user.username === 'admin') {
                    return { success: false, message: 'Impossible de supprimer le compte administrateur principal.' };
                }
            } else {
                stmt.free();
            }

            db.run(`DELETE FROM users WHERE id=?`, [id]);
            saveToFile();
            return { success: true };
        } catch(e) { return { success: false, message: e.message }; }
    });

    ipcMain.handle('get-clients', () => {
        const res = db.exec('SELECT * FROM clients');
        return formatResult(res);
    });

    ipcMain.handle('get-materials', () => {
        const res = db.exec('SELECT * FROM materials');
        return formatResult(res);
    });

    ipcMain.handle('get-payments', () => {
        try {
            const res = db.exec('SELECT * FROM payments ORDER BY date DESC, id DESC');
            return formatResult(res);
        } catch(e) {
            return [];
        }
    });

    ipcMain.handle('get-pending-messages', () => {
        try {
            const res = db.exec(`
                SELECT p.*, c.name AS clientName, c.brand AS clientBrand
                FROM pending_messages p
                LEFT JOIN clients c ON p.clientId = c.id
                WHERE p.status = 'Pending'
                ORDER BY p.created_at DESC
            `);
            return formatResult(res);
        } catch(e) {
            return [];
        }
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
                // Preserve fields not always carried in memory
                const preserved = {};
                const pRes = db.exec(`SELECT id, telegramChatId, promisedDate, promisedAmount, promisedMethod, promiseNote, installed_at FROM clients`);
                if (pRes.length) {
                    pRes[0].values.forEach(row => {
                        preserved[row[0]] = { telegramChatId: row[1], promisedDate: row[2], promisedAmount: row[3], promisedMethod: row[4], promiseNote: row[5], installed_at: row[6] };
                    });
                }

                db.run('BEGIN');
                try {
                    db.run('DELETE FROM clients');
                    const sql = `INSERT OR REPLACE INTO clients (id, name, phone, brand, potential, address, source, options, note, installer, material, paymentStatus, paymentMode, finalState, noPurchaseReason, created_at, called, dateDernierRappel, trialStatus, trialStartDate, trialPeriod, category, added_by, negotiatedPrice, paidAmount, paymentDeadline, autoReminder, telegramChatId, promisedDate, promisedAmount, promisedMethod, promiseNote, trialOutcome, trialLostReason, installed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                    const stmt = db.prepare(sql);
                    for (const c of data.clients) {
                        const p = preserved[c.id] || {};
                        stmt.run([
                            c.id, c.name, c.phone, c.brand, (c.potential?1:0), c.address, c.source,
                            JSON.stringify(c.options || []), c.note || '', c.installer || '', c.material || 'Non',
                            c.paymentStatus || '', c.paymentMode || '', c.finalState || '', c.noPurchaseReason || '',
                            c.created_at || '', (c.called?1:0), c.dateDernierRappel || '', (c.trialStatus || 0),
                            c.trialStartDate || '', c.trialPeriod || 15, c.category || 'Nouveau', c.added_by || '',
                            c.negotiatedPrice || 0, c.paidAmount || 0, c.paymentDeadline || '', (c.autoReminder?1:0),
                            c.telegramChatId || p.telegramChatId || null,
                            c.promisedDate || p.promisedDate || null,
                            c.promisedAmount || p.promisedAmount || 0,
                            c.promisedMethod || p.promisedMethod || null,
                            c.promiseNote || p.promiseNote || null,
                            c.trialOutcome || '', c.trialLostReason || '',
                            c.installed_at || p.installed_at || null
                        ]);
                    }
                    stmt.free();
                    db.run('COMMIT');
                } catch(txErr) {
                    db.run('ROLLBACK');
                    throw txErr;
                }
            }

            if (data.materials) {
                db.run('DELETE FROM materials');
                const stmt = db.prepare('INSERT OR REPLACE INTO materials (id, name, stock, price, note) VALUES (?, ?, ?, ?, ?)');
                for (const m of data.materials) {
                    stmt.run([m.id, m.name, m.stock, m.price, m.note]);
                }
                stmt.free();
            }

            if (data.payments) {
                db.run('DELETE FROM payments');
                const stmt = db.prepare('INSERT OR REPLACE INTO payments (id, clientId, clientName, amount, date, method, notes) VALUES (?, ?, ?, ?, ?, ?, ?)');
                for (const p of data.payments) {
                    stmt.run([p.id || null, p.clientId, p.clientName, p.amount, p.date, p.method, p.notes || '']);
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
    ipcMain.handle('save-payments', (event, paymentsArray) => saveAll(event, { payments: paymentsArray }));
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
            clientData.category || 'Nouveau',
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

// Save a payment promise for a client
function savePaymentPromise(clientId, { promisedDate, promisedAmount, promisedMethod, promiseNote }) {
    try {
        db.run(
            `UPDATE clients SET promisedDate=?, promisedAmount=?, promisedMethod=?, promiseNote=? WHERE id=?`,
            [promisedDate || '', promisedAmount || 0, promisedMethod || '', promiseNote || '', clientId]
        );
        saveToFile();
        return true;
    } catch(e) { return false; }
}

// Returns clients with a promisedDate today or overdue and still unpaid
function getDuePromises() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const res = db.exec(`
            SELECT id, name, phone, brand, promisedDate, promisedAmount, promisedMethod, promiseNote,
                   negotiatedPrice, paidAmount, telegramChatId
            FROM clients
            WHERE promisedDate IS NOT NULL AND promisedDate != ''
              AND promisedDate <= '${today}'
              AND paymentStatus != 'Régler'
            ORDER BY promisedDate ASC
        `);
        if (!res.length) return [];
        const cols = res[0].columns;
        return res[0].values.map(row => {
            const obj = {};
            cols.forEach((c, i) => obj[c] = row[i]);
            return obj;
        });
    } catch(e) { return []; }
}

function getDB() { return db; }

// Returns sold clients filtered by paymentStatus
// filter: 'all' | 'Régler' | 'Verser'
function getSoldClients(filter) {
    try {
        let where = `paymentStatus IN ('Régler','Verser')`;
        if (filter === 'Régler') where = `paymentStatus = 'Régler'`;
        else if (filter === 'Verser') where = `paymentStatus = 'Verser'`;
        const res = db.exec(`
            SELECT id, name, phone, brand, paymentStatus, paidAmount, negotiatedPrice, telegramChatId, created_at
            FROM clients WHERE ${where} ORDER BY created_at DESC
        `);
        if (!res.length) return [];
        const cols = res[0].columns;
        return res[0].values.map(row => {
            const obj = {};
            cols.forEach((c, i) => obj[c] = row[i]);
            return obj;
        });
    } catch(e) { return []; }
}

// Returns unpaid clients whose paymentDeadline (or created_at) is older than `days` days ago
function getUnpaidClientsByPeriod(days) {
    try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().split('T')[0]; // YYYY-MM-DD

        const res = db.exec(`
            SELECT id, name, phone, brand, note, paymentDeadline, created_at, paidAmount, negotiatedPrice, telegramChatId
            FROM clients
            WHERE paymentStatus = 'Non'
              AND (
                (paymentDeadline IS NOT NULL AND paymentDeadline != '' AND paymentDeadline <= '${cutoffStr}')
                OR
                (( paymentDeadline IS NULL OR paymentDeadline = '') AND created_at <= '${cutoffStr}')
              )
            ORDER BY paymentDeadline ASC, created_at ASC
        `);
        if (!res.length) return [];
        const cols = res[0].columns;
        return res[0].values.map(row => {
            const obj = {};
            cols.forEach((c, i) => obj[c] = row[i]);
            return obj;
        });
    } catch(e) {
        return [];
    }
}

// Save telegramChatId for a client matched by phone
function linkClientTelegram(phone, chatId) {
    try {
        db.run(`UPDATE clients SET telegramChatId = ? WHERE phone = ?`, [String(chatId), phone]);
        saveToFile();
    } catch(e) {}
}

// Queue a Telegram message to a client
function queueTelegramMessage(clientId, chatId, message) {
    try {
        const now = new Date().toISOString();
        db.run(
            `INSERT INTO pending_messages (clientId, phone, message, channel, status, created_at) VALUES (?, ?, ?, ?, 'Pending', ?)`,
            [clientId || null, String(chatId), message, 'Telegram', now]
        );
        saveToFile();

        // Broadcast to all windows
        const { BrowserWindow } = require('electron');
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('refresh-moderation');
        });
        return true;
    } catch(e) {
        console.error('[DB] Failed to queue Telegram message:', e.message);
        return false;
    }
}

module.exports = { initDB, registerIpcHandlers, addClientManually, getDB, getUnpaidClientsByPeriod, linkClientTelegram, getSoldClients, savePaymentPromise, getDuePromises, saveToFile, queueTelegramMessage };
