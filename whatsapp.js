const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { parsePromiseWithGroq } = require('./promise-parser');

let waClient = null;
let waReady = false;
let waQrCallback = null;
let adminNotifyCallback = null; // called when a promise is auto-saved

function getSessionPath() {
    return path.join(app.getPath('userData'), 'whatsapp-session');
}

function getGroqKey() {
    try {
        const p = path.join(app.getPath('userData'), 'telegram-config.json');
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')).groqApiKey || '';
    } catch(e) {}
    return '';
}

function getAdminChatId() {
    try {
        const p = path.join(app.getPath('userData'), 'telegram-config.json');
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')).adminChatId || null;
    } catch(e) {}
    return null;
}

// Normalize any Algerian phone to 213XXXXXXXXX
function normalizePhone(raw) {
    return raw.replace(/\s/g, '').replace(/^0/, '213').replace(/^\+/, '');
}

// Extract phone from WhatsApp sender ID: "213661234567@c.us" → "213661234567"
function phoneFromWaId(waId) {
    return waId.replace('@c.us', '').replace('@g.us', '');
}

function initWhatsApp(onQr, onAdminNotify) {
    if (waClient) return;
    if (onQr) waQrCallback = onQr;
    if (onAdminNotify) adminNotifyCallback = onAdminNotify;

    waClient = new Client({
        authStrategy: new LocalAuth({ dataPath: getSessionPath() }),
        puppeteer: {
            headless: true,
            executablePath: (() => {
                const paths = [
                    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
                ];
                const fs = require('fs');
                return paths.find(p => fs.existsSync(p)) || undefined;
            })(),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--no-first-run',
                '--no-zygote',
            ],
            timeout: 60000,
        },
    });

    waClient.on('qr', (qr) => {
        console.log('\n[WhatsApp] Scan this QR code with your phone:\n');
        qrcode.generate(qr, { small: true });
        if (waQrCallback) waQrCallback(qr);
    });

    waClient.on('ready', () => {
        waReady = true;
        console.log('[WhatsApp] Client ready ✅');
        const { BrowserWindow } = require('electron');
        const wins = BrowserWindow.getAllWindows();
        if (wins.length) wins[0].webContents.send('whatsapp-ready');
    });

    waClient.on('authenticated', () => {
        console.log('[WhatsApp] Authenticated ✅');
    });

    waClient.on('auth_failure', (msg) => {
        waReady = false;
        console.error('[WhatsApp] Auth failure:', msg);
    });

    waClient.on('disconnected', (reason) => {
        waReady = false;
        waClient = null;
        console.warn('[WhatsApp] Disconnected:', reason);
        setTimeout(() => initWhatsApp(null, adminNotifyCallback), 10000);
    });

    // ── Incoming message handler ─────────────────────────────────────────────
    waClient.on('message', async (msg) => {
        // Ignore group messages and messages sent by us
        if (msg.fromMe || msg.from.endsWith('@g.us')) return;

        const senderPhone = phoneFromWaId(msg.from); // e.g. "213661234567"
        const text = msg.body || '';
        if (!text.trim()) return;

        try {
            const { getDB, savePaymentPromise } = require('./db');
            const db = getDB();
            if (!db) return;

            // Match sender to a client in the DB by phone
            // senderPhone is always 213XXXXXXXXX (9 digits after 213)
            const localPhone = '0' + senderPhone.slice(3); // 0XXXXXXXXX
            const res = db.exec(
                `SELECT id, name, phone, negotiatedPrice, paidAmount, promisedDate FROM clients
                 WHERE replace(phone,' ','') = '${senderPhone}'
                    OR replace(phone,' ','') = '${localPhone}'
                    OR replace(phone,' ','') = '+${senderPhone}'
                 LIMIT 1`
            );
            console.log(`[WhatsApp] Incoming from ${senderPhone} / ${localPhone} — matched: ${res.length > 0}`);
            if (!res.length) return; // unknown sender

            const cols = res[0].columns;
            const row = res[0].values[0];
            const client = {};
            cols.forEach((c, i) => client[c] = row[i]);

            const balance = Math.max(0, (client.negotiatedPrice || 0) - (client.paidAmount || 0));
            if (balance <= 0) return; // already paid, skip

            // Parse promise with Groq
            const groqKey = getGroqKey();
            const parsed = await parsePromiseWithGroq(text, groqKey);
            if (!parsed) return;

            // Save to DB
            savePaymentPromise(client.id, {
                promisedDate:   parsed.promisedDate   || '',
                promisedAmount: parsed.promisedAmount  || 0,
                promisedMethod: parsed.promisedMethod  || '',
                promiseNote:    parsed.promiseNote     || text.slice(0, 200),
            });

            console.log(`[WhatsApp] Promise auto-saved for ${client.name}`);

            // Notify admin via callback (Telegram bot will send the alert)
            if (adminNotifyCallback) {
                adminNotifyCallback({
                    channel: 'WhatsApp',
                    clientName: client.name,
                    clientPhone: client.phone,
                    parsed,
                    rawMessage: text,
                });
            }

            // Confirm back to the client on WhatsApp
            const confirmMsg =
                `✅ Merci ${client.name} ! On a bien noté votre promesse de paiement` +
                `${parsed.promisedDate ? ` pour le *${parsed.promisedDate}*` : ''}` +
                `${parsed.promisedAmount ? ` de *${parsed.promisedAmount.toLocaleString('fr-DZ')} DA*` : ''}` +
                `${parsed.promisedMethod ? ` par *${parsed.promisedMethod}*` : ''}` +
                `.\n\nNous vous contacterons à cette date. Merci ! 🙏`;
            await waClient.sendMessage(msg.from, confirmMsg);

        } catch(e) {
            console.error('[WhatsApp] Promise parse error:', e.message);
        }
    });

    waClient.initialize().catch(err => {
        console.error('[WhatsApp] Init error:', err.message);
        waClient = null;
    });
}

async function sendWhatsApp(phone, message) {
    if (!waClient || !waReady) throw new Error('WhatsApp client not ready');
    let normalized = normalizePhone(phone);
    if (!normalized.startsWith('213')) normalized = '213' + normalized;
    const chatId = `${normalized}@c.us`;
    await waClient.sendMessage(chatId, message);
    return chatId;
}

function isWhatsAppReady() { return waReady; }
function getWhatsAppStatus() {
    if (!waClient) return 'disconnected';
    if (waReady) return 'ready';
    return 'connecting';
}

module.exports = { initWhatsApp, sendWhatsApp, isWhatsAppReady, getWhatsAppStatus };
