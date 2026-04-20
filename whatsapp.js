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
            const groqKey = getGroqKey();

            // Try to match sender to a known client with a balance
            let promiseHandled = false;
            if (db) {
                const localPhone = '0' + senderPhone.slice(3);
                const res = db.exec(
                    `SELECT id, name, phone, negotiatedPrice, paidAmount FROM clients
                     WHERE replace(phone,' ','') = '${senderPhone}'
                        OR replace(phone,' ','') = '${localPhone}'
                        OR replace(phone,' ','') = '+${senderPhone}'
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
                            await waClient.sendMessage(msg.from, confirmMsg);
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
