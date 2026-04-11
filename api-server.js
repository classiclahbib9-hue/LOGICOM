const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const PORT = 3737;
let dbRef = null; // set by startApiServer()

// ── Key storage ──────────────────────────────────────────────────────────────
function keysPath() {
  return path.join(app.getPath('userData'), 'logicom-api-keys.json');
}

function loadKeys() {
  try {
    if (fs.existsSync(keysPath())) return JSON.parse(fs.readFileSync(keysPath(), 'utf8'));
  } catch(e) {}
  return [];
}

function saveKeys(keys) {
  fs.writeFileSync(keysPath(), JSON.stringify(keys, null, 2));
}

function generateKey() {
  return 'logi-' + crypto.randomBytes(24).toString('hex');
}

function validateKey(key) {
  return loadKeys().find(k => k.key === key && k.active);
}

// ── DB helpers ────────────────────────────────────────────────────────────────
function queryDB(sql) {
  if (!dbRef) return [];
  try {
    const res = dbRef.exec(sql);
    if (!res || res.length === 0) return [];
    const cols = res[0].columns;
    return res[0].values.map(row => {
      const obj = {};
      cols.forEach((c, i) => { obj[c] = row[i]; });
      return obj;
    });
  } catch(e) { return []; }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  });
  res.end(body);
}

function auth(req, res) {
  const header = req.headers['authorization'] || '';
  const key = header.replace(/^Bearer\s+/i, '').trim();
  if (!key || !validateKey(key)) {
    send(res, 401, { error: 'Unauthorized — invalid or missing API key' });
    return null;
  }
  return key;
}

// ── Server ────────────────────────────────────────────────────────────────────
let server = null;

function startApiServer(db) {
  dbRef = db;

  if (server) return; // already running

  server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { send(res, 204, {}); return; }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const route = url.pathname;

    // ── Public ──
    if (route === '/api/ping') {
      send(res, 200, { status: 'ok', app: 'LOGICOM', version: '1.0' });
      return;
    }

    // ── Protected ──
    if (!auth(req, res)) return;

    if (route === '/api/clients') {
      const clients = queryDB('SELECT * FROM clients');
      send(res, 200, { count: clients.length, data: clients });
    } else if (route === '/api/options') {
      const options = queryDB('SELECT * FROM options');
      send(res, 200, { count: options.length, data: options });
    } else if (route === '/api/activities') {
      const activities = queryDB('SELECT * FROM activities');
      send(res, 200, { count: activities.length, data: activities });
    } else if (route === '/api/materials') {
      const materials = queryDB('SELECT * FROM materials');
      send(res, 200, { count: materials.length, data: materials });
    } else if (route === '/api/stats') {
      const clients = queryDB('SELECT paymentStatus, negotiatedPrice, paidAmount, trialStatus FROM clients');
      const paid = clients.filter(c => c.paymentStatus === 'Oui').length;
      const unpaid = clients.filter(c => c.paymentStatus === 'Non').length;
      const trials = clients.filter(c => c.trialStatus === 1).length;
      const totalRevenue = clients.reduce((s, c) => s + (c.negotiatedPrice || 0), 0);
      const collected = clients.reduce((s, c) => s + (c.paidAmount || 0), 0);
      send(res, 200, {
        totalClients: clients.length,
        paid, unpaid, trials,
        totalRevenue, collected,
        remaining: totalRevenue - collected
      });
    } else {
      send(res, 404, { error: 'Route not found' });
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[LOGICOM API] Server running on port ${PORT}`);
  });

  server.on('error', (e) => {
    console.error('[LOGICOM API] Server error:', e.message);
  });
}

function stopApiServer() {
  if (server) { server.close(); server = null; }
}

module.exports = { startApiServer, stopApiServer, generateKey, loadKeys, saveKeys };
