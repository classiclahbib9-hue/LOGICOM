const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
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

const WA_SYSTEM_PROMPT = `أنت مساعد ذكي اسمك "لوجي" تتكلم الدارجة الجزائرية فقط.
تعمل لدى شركة LOGICOM الجزائرية متخصصة في بيع برامج تسيير الأعمال.
منتجاتنا: برامج تسيير للسوبيرات، الصيدلية، المخبزة، القنصلية، المصانع، المطاعم. الأسعار تبدأ من 15,000 DA.
جاوب دايما بالدارجة الجزائرية — ما تستعملش العربية الفصحى. إذا كلمك بالفرنسية جاوبه بالفرنسية.
كون مختصر — جملتين أو ثلاثة تكفي. إذا السؤال تقني، قول يتصل بالدعم.`;

const WA_FAQ = [
    { kw: ['prix','tarif','pack','combien','qaddach','bchhal','sh7al','taman'], ans: '💰 الأسعار تبدأ من 15,000 DA حسب نوع النشاط. واش تاع شنو activité تاعك؟' },
    { kw: ['superette','epicerie','hanout','magasin','supérette'], ans: '🏪 برنامج السوبيريت يشمل caisse + stock + clients\n💰 Prix à partir de 19,000 DA\n📞 اتصل بينا باش تجرب مجانا!' },
    { kw: ['pharmacie','medicament','saidliya','dawa'], ans: '💊 برنامج الصيدلية يشمل médicaments + ordonnances + caisse\n📞 اتصل بينا باش تجرب مجانا!' },
    { kw: ['boulangerie','pain','khobz','ferran'], ans: '🥖 برنامج المخبزة يشمل production + caisse + livraisons\n📞 اتصل بينا باش تجرب مجانا!' },
    { kw: ['restaurant','cafe','snack','mat3am','kahwa'], ans: '🍕 برنامج المطعم يشمل caisse tactile + tables + livreurs\n📞 اتصل بينا باش تجرب مجانا!' },
    { kw: ['install','setup','tanzil','rockeb'], ans: '⚙️ للتركيب: نزّل setup، شغّله كـadministrateur، اتبع الخطوات. إذا عندك مشكل contacti support.' },
    { kw: ['facture','fatura','devis'], ans: '🧾 باش تدير facture: Menu → Ventes → Nouvelle facture' },
    { kw: ['stock','makhzen'], ans: '📦 باش تدير stock: Menu → Stock → Bon d\'entrée / Bon de sortie' },
    { kw: ['bug','mochkil','ma khdamch','khrab','problem'], ans: '🛠️ سكّر البرنامج وعاود افتحه. إذا مزال — contacti support LOGICOM.' },
    { kw: ['essai','demo','gratuit','mjaani','njarreb'], ans: '🆓 تقدر تجرب مجانا! contacti-na وندّيرلك version demo.' },
];

function waDetectFaq(text) {
    const t = text.toLowerCase();
    return WA_FAQ.find(e => e.kw.some(k => t.includes(k))) || null;
}

function waAskGroq(text, groqKey) {
    return new Promise((resolve) => {
        const body = JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            max_tokens: 250,
            messages: [
                { role: 'system', content: WA_SYSTEM_PROMPT },
                { role: 'user', content: text }
            ]
        });
        const req = https.request({
            hostname: 'api.groq.com',
            path: '/openai/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + groqKey,
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data).choices?.[0]?.message?.content || null); }
                catch(e) { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.write(body);
        req.end();
    });
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
            headless: false,
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--no-first-run',
                '--no-zygote',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
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

    waClient.on('loading_screen', (percent, message) => {
        console.log('[WhatsApp] Loading:', percent, message);
    });

    waClient.on('change_state', state => {
        console.log('[WhatsApp] State changed:', state);
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
            const groqKey = getGroqKey();

            // Try to match sender to a known client with a balance
            let promiseHandled = false;
            if (db) {
                const safePhone = senderPhone.replace(/[^0-9]/g, '');
                const localPhone = '0' + safePhone.slice(3);
                const res = db.exec(
                    `SELECT id, name, phone, negotiatedPrice, paidAmount FROM clients
                     WHERE replace(phone,' ','') = '${safePhone}'
                        OR replace(phone,' ','') = '${localPhone}'
                        OR replace(phone,' ','') = '+${safePhone}'
                     LIMIT 1`
                );
                console.log(`[WhatsApp] Incoming from ${senderPhone} — matched: ${res.length > 0}`);

                if (res.length) {
                    const client = {};
                    res[0].columns.forEach((c, i) => client[c] = res[0].values[0][i]);
                    const balance = Math.max(0, (client.negotiatedPrice || 0) - (client.paidAmount || 0));

                    if (balance > 0) {
                        const parsed = await parsePromiseWithGroq(text, groqKey);
                        if (parsed) {
                            savePaymentPromise(client.id, {
                                promisedDate:   parsed.promisedDate   || '',
                                promisedAmount: parsed.promisedAmount  || 0,
                                promisedMethod: parsed.promisedMethod  || '',
                                promiseNote:    parsed.promiseNote     || text.slice(0, 200),
                            });
                            console.log(`[WhatsApp] Promise auto-saved for ${client.name}`);
                            if (adminNotifyCallback) {
                                adminNotifyCallback({ channel: 'WhatsApp', clientName: client.name, clientPhone: client.phone, parsed, rawMessage: text });
                            }
                            const confirmMsg =
                                `✅ Merci ${client.name} ! On a bien noté votre promesse de paiement` +
                                `${parsed.promisedDate ? ` pour le ${parsed.promisedDate}` : ''}` +
                                `${parsed.promisedAmount ? ` de ${parsed.promisedAmount.toLocaleString('fr-DZ')} DA` : ''}` +
                                `${parsed.promisedMethod ? ` par ${parsed.promisedMethod}` : ''}` +
                                `.\n\nNous vous contacterons à cette date. Merci 🙏`;
                            await Promise.race([
                                waClient.sendMessage(msg.from, confirmMsg),
                                new Promise((_, reject) => setTimeout(() => reject(new Error('Send timeout')), 20000))
                            ]);
                            promiseHandled = true;
                        }
                    }
                }
            }

            // Auto-response disabled

        } catch(e) {
            console.error('[WhatsApp] Message handler error:', e.message);
        }
    });

    console.log('[WhatsApp] Initializing...');
    waClient.initialize().catch(err => {
        console.error('[WhatsApp] Init error:', err.message);
        waClient = null;
    });
}

function getWasenderConfig() {
    try {
        const p = path.join(app.getPath('userData'), 'telegram-config.json');
        if (fs.existsSync(p)) {
            const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
            return {
                enabled: !!cfg.wasenderEnabled,
                apiKey: cfg.wasenderApiKey || ''
            };
        }
    } catch(e) {}
    return { enabled: false, apiKey: '' };
}

function sendViaWasender(phone, message, apiKey) {
    return new Promise((resolve, reject) => {
        let normalized = normalizePhone(phone);
        if (!normalized.startsWith('213')) normalized = '213' + normalized;

        const body = JSON.stringify({
            to: normalized,
            text: message
        });

        const req = https.request({
            hostname: 'www.wasenderapi.com',
            path: '/api/send-message',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey,
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                console.log('[WASender] Response status:', res.statusCode, 'data:', data);
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ success: true, data: data });
                } else {
                    reject(new Error(`WASender API error (${res.statusCode}): ${data}`));
                }
            });
        });

        req.on('error', (err) => {
            console.error('[WASender] Connection error:', err.message);
            reject(err);
        });

        req.write(body);
        req.end();
    });
}

async function sendWhatsApp(phone, message) {
    const wasender = getWasenderConfig();
    const rawPhones = String(phone || '').split(/[,\/;]+/).map(p => p.trim()).filter(p => p.length > 5);
    
    if (!rawPhones.length) throw new Error('Aucun numéro de téléphone valide');

    let successCount = 0;
    let lastErr = null;
    let lastChatId = '';

    for (const rawPhone of rawPhones) {
        try {
            if (wasender.enabled && wasender.apiKey) {
                console.log('[WA] Sending via WASender API for phone:', rawPhone);
                await sendViaWasender(rawPhone, message, wasender.apiKey);
                lastChatId = `${normalizePhone(rawPhone)}@c.us`;
                successCount++;
            } else {
                if (!waClient) throw new Error('WhatsApp client not ready');
                let normalized = normalizePhone(rawPhone);
                if (!normalized.startsWith('213')) normalized = '213' + normalized;
                const chatId = `${normalized}@c.us`;
                
                console.log('[WA] RAW PHONE:', rawPhone);
                console.log('[WA] NORMALIZED:', normalized);
                console.log('[WA] CHAT ID:', chatId);

                await Promise.race([
                   waClient.sendMessage(chatId, message),
                   new Promise((_, reject) => setTimeout(() => reject(new Error('Send timeout')), 20000))
                ]);
                console.log('[WA] SENT SUCCESS for', rawPhone);
                lastChatId = chatId;
                successCount++;
            }
        } catch(err) {
            console.error('[WA] SEND FAILED for', rawPhone, err.message || err);
            lastErr = err;
        }
    }

    if (successCount === 0 && lastErr) {
        throw lastErr;
    }

    return lastChatId || `${normalizePhone(rawPhones[0])}@c.us`;
}

function isWhatsAppReady() { 
    const wasender = getWasenderConfig();
    if (wasender.enabled && wasender.apiKey) return true;
    return waReady; 
}

function getWhatsAppStatus() {
    const wasender = getWasenderConfig();
    if (wasender.enabled && wasender.apiKey) return 'ready';

    if (!waClient) return 'disconnected';
    if (waReady) return 'ready';
    return 'connecting';
}

let bulkQueueRunning = false;
let bulkQueueStop = false;

async function processBulkWhatsApp(clients, template, event) {
    if (bulkQueueRunning) throw new Error('Bulk already running');
    
    bulkQueueRunning = true;
    bulkQueueStop = false;
    let success = 0;
    let failed = 0;

    try {
        for (let i = 0; i < clients.length; i++) {
            console.log(`[Bulk WA] Processing client ${i + 1} / ${clients.length}`);
            if (bulkQueueStop) break;
            const client = clients[i];
            console.log('SENDING TO:', client.phone);

            try {
                const bal = client.balance || 0;
                if (bal <= 0) {
                    console.log(`[Bulk WA] Skipping ${client.name} because balance is 0.00`);
                    continue;
                }
                let personalized = template
                    .replaceAll('{name}', client.name || '')
                    .replaceAll('{balance}', bal.toLocaleString('fr-DZ'))
                    .replaceAll('{brand}', client.brand || '')
                    .replaceAll('{phone}', client.phone || '');

                await sendWhatsApp(client.phone, personalized);
                
                // Update DB
                const { getDB, saveToFile } = require('./db');
                const db = getDB();
                const today = new Date().toLocaleDateString('fr-FR');
                if (db && client.id) {
                    db.run(`UPDATE clients SET dateDernierRappel=? WHERE id=?`, [today, client.id]);
                    saveToFile();
                }

                success++;
                event.sender.send('bulk-wa-progress', {
                    current: i + 1,
                    total: clients.length,
                    success,
                    failed,
                    client: client.name,
                    clientId: client.id,
                    date: today
                });
            } catch (err) {
                failed++;
                console.error('[Bulk WA] Failed:', client.phone, err.message);
                event.sender.send('bulk-wa-error', { client: client.name, phone: client.phone, error: err.message || String(err) });
            }

            // Random delay: 2.0s to 4.5s
            const delayTime = Math.floor(Math.random() * 2500) + 2000;
            await new Promise(r => setTimeout(r, delayTime));
        }
    } finally {
        bulkQueueRunning = false;
        event.sender.send('bulk-wa-finished', { success, failed, stopped: bulkQueueStop });
    }
}

async function resetWhatsApp(onQr, onAdminNotify) {
    console.log('[WhatsApp] Resetting client and clearing session...');
    waReady = false;
    
    if (waClient) {
        try {
            console.log('[WhatsApp] Destroying current waClient...');
            await waClient.destroy();
        } catch (e) {
            console.error('[WhatsApp] Error destroying client:', e.message);
        }
        waClient = null;
    }
    
    // Clear session path
    const sessionPath = getSessionPath();
    if (fs.existsSync(sessionPath)) {
        try {
            // Give system some time to unlock files just in case
            await new Promise(r => setTimeout(r, 1000));
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log('[WhatsApp] Session folder cleared successfully.');
        } catch (e) {
            console.error('[WhatsApp] Error clearing session folder:', e.message);
        }
    }
    
    // Clear remote web cache if present
    const cachePath = path.join(process.cwd(), '.wwebjs_cache');
    if (fs.existsSync(cachePath)) {
        try {
            fs.rmSync(cachePath, { recursive: true, force: true });
            console.log('[WhatsApp] Cache folder (.wwebjs_cache) cleared successfully.');
        } catch (e) {
            console.error('[WhatsApp] Error clearing cache folder:', e.message);
        }
    }
    
    // Reset callbacks to make sure we don't lose them
    if (onQr) waQrCallback = onQr;
    if (onAdminNotify) adminNotifyCallback = onAdminNotify;
    
    console.log('[WhatsApp] Re-initializing fresh client...');
    initWhatsApp(waQrCallback, adminNotifyCallback);
}

async function checkWhatsAppNumber(phone) {
    const wasender = getWasenderConfig();
    if (wasender.enabled && wasender.apiKey) {
        return true;
    }

    if (!waClient || !waReady) {
        throw new Error("Client WhatsApp non connecté. Connectez WhatsApp d'abord dans le dernier onglet.");
    }

    let normalized = normalizePhone(phone);
    if (!normalized.startsWith('213')) normalized = '213' + normalized;
    const chatId = `${normalized}@c.us`;

    try {
        const isRegistered = await waClient.isRegisteredUser(chatId);
        return isRegistered;
    } catch (err) {
        console.error('[WhatsApp] checkWhatsAppNumber failed for:', phone, err.message);
        return false;
    }
}

module.exports = { 
    initWhatsApp, 
    sendWhatsApp, 
    isWhatsAppReady, 
    getWhatsAppStatus,
    processBulkWhatsApp,
    stopBulkWA: () => { bulkQueueStop = true; },
    resetWhatsApp,
    checkWhatsAppNumber
};
