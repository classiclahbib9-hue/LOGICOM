/**
 * bot-server.js — Standalone Telegram bot (no Electron dependency)
 * Run with: pm2 start bot-server.js --name logicom-bot
 */

'use strict';

const TelegramBot   = require('node-telegram-bot-api');
const initSqlJs     = require('sql.js');
const fs            = require('fs');
const path          = require('path');
const https         = require('https');
const { parsePromiseWithGroq } = require('./promise-parser');

// ── Config paths ────────────────────────────────────────────────────────────
const DB_PATH      = path.join(__dirname, 'test.db');
const CONFIG_PATH  = path.join(__dirname, 'bot-config.json');
const PACKS_FILE   = path.join(__dirname, 'packs.json');
const PENDING_FILE = path.join(__dirname, 'pending-clients.json');

// ── Load bot config ──────────────────────────────────────────────────────────
function loadConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
    catch(e) { return {}; }
}

function getGroqKey()    { return loadConfig().groqApiKey || ''; }
function getBotToken()   { return loadConfig().token || ''; }
function getAdminId()    { return loadConfig().adminChatId || null; }

// ── SQL.js DB (shared file with Electron app) ────────────────────────────────
let SQL, db;
let dbLastMtime = 0; // track last file modification time to avoid redundant reloads

async function initDB() {
    SQL = await initSqlJs({ locateFile: f => path.join(__dirname, 'node_modules/sql.js/dist', f) });
    loadDB();
    // Only reload when Electron actually writes a new version of the file
    fs.watchFile(DB_PATH, { interval: 3000 }, (curr) => {
        if (curr.mtimeMs !== dbLastMtime) {
            loadDB();
        }
    });
}

function loadDB() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const stat = fs.statSync(DB_PATH);
            if (stat.mtimeMs === dbLastMtime && db) return; // already up to date
            db = new SQL.Database(fs.readFileSync(DB_PATH));
            dbLastMtime = stat.mtimeMs;
        }
    } catch(e) { console.error('[DB] reload error:', e.message); }
}

function saveDB() {
    try {
        if (!db) return;
        fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
        dbLastMtime = fs.statSync(DB_PATH).mtimeMs; // update mtime so we don't re-reload our own write
    } catch(e) { console.error('[DB] save error:', e.message); }
}

function dbExec(sql) {
    if (!db) return [];
    try { return db.exec(sql); } catch(e) { return []; }
}

function dbRun(sql, params) {
    if (!db) return;
    try { db.run(sql, params || []); saveDB(); } catch(e) { console.error('[DB] run error:', e.message); }
}

// ── Pending queue — survives PC off, Electron imports on next startup ────────
function readPending() {
    try { return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8')); } catch(e) { return []; }
}
function writePending(list) {
    fs.writeFileSync(PENDING_FILE, JSON.stringify(list, null, 2));
}

function addClient({ name, phone, brand, note, addedBy, category }) {
    const today = new Date().toISOString().split('T')[0];
    const client = {
        name: name || 'Nouveau Client', phone: phone || '', brand: brand || '',
        potential: 1, address: '', source: 'Telegram', options: '[]',
        note: note || '', installer: 'Non', material: 'Non', paymentStatus: 'Non',
        paymentMode: '', finalState: '', noPurchaseReason: '', created_at: today,
        called: 0, trialStatus: 0, trialStartDate: '', trialPeriod: 15,
        category: category || 'Nouveau', added_by: addedBy || 'Bot',
        _pendingAt: new Date().toISOString()
    };
    const list = readPending();
    list.push(client);
    writePending(list);
    console.log(`[Bot] Client queued for sync: ${client.name} (${list.length} pending)`);
}

function getUnpaidClients(days) {
    const res = dbExec(`
        SELECT id, name, phone, brand, negotiatedPrice, paidAmount, telegramChatId
        FROM clients
        WHERE (negotiatedPrice - paidAmount) > 0
        ${days > 0 ? `AND (julianday('now') - julianday(created_at)) <= ${days}` : ''}
        AND (trialStatus IS NULL OR trialStatus = 0)
        ORDER BY (negotiatedPrice - paidAmount) DESC
    `);
    if (!res.length) return [];
    return res[0].values.map(r => {
        const obj = {};
        res[0].columns.forEach((c, i) => obj[c] = r[i]);
        return obj;
    });
}

function savePaymentPromise(clientId, { promisedDate, promisedAmount, promisedMethod, promiseNote }) {
    dbRun(
        `UPDATE clients SET promisedDate=?, promisedAmount=?, promisedMethod=?, promiseNote=? WHERE id=?`,
        [promisedDate || '', promisedAmount || 0, promisedMethod || '', promiseNote || '', clientId]
    );
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
function loadPacks() {
    try { return JSON.parse(fs.readFileSync(PACKS_FILE, 'utf8')); }
    catch(e) { return {}; }
}

// ── Copy all bot logic from telegram.js (Electron-free) ─────────────────────
// (Paste the detectLanguage, detectSecteur, FAQ, SECTEUR_KEYWORDS, etc.)
const GROQ_SYSTEM_PROMPT = `أنت مساعد ذكي اسمك "لوجي" تتكلم الدارجة الجزائرية فقط.
تعمل لدى شركة LOGICOM الجزائرية متخصصة في بيع برامج تسيير الأعمال.
الأسعار تبدأ من 15,000 DA. الدعم التقني متوفر والتركيب في عين المكان.
جاوب دايما بالدارجة الجزائرية — ما تستعملش العربية الفصحى أبدا.
كون مختصر — جملتين أو ثلاثة تكفي. إذا السؤال تقني معقد قول ليه يتصل بالدعم.`;

const SECTEUR_KEYWORDS = {
    superette:     ['superette','supérette','epicerie','épicerie','magasin','hanout','supermarche'],
    pharmacie:     ['pharmacie','medicament','médicament','ordonnance','saidliya','dawa'],
    boulangerie:   ['boulangerie','pain','gateau','khobz','ferran','mkhabez'],
    quincaillerie: ['quincaillerie','materiaux','matériaux','ferronnerie','hdida','binaya'],
    industrie:     ['industrie','usine','fabrication','production','masna3'],
    restaurant:    ['restaurant','cafe','café','snack','pizzeria','mat3am','kahwa'],
};

const FAQ = [
    { kw: ['prix','tarif','pack','combien','qaddach','bchhal','sh7al','taman'], pack_query: true },
    { kw: ['install','setup','tanzil','rockeb','télécharger'],
      ans: '⚙️ Bach t-install :\n1. Nzal setup\n2. D-marré ki administrateur\n3. Sib l-étapes' },
    { kw: ['facture','fatura','devis'],
      ans: '🧾 Bach dir facture :\nMenu → Ventes → Nouvelle facture' },
    { kw: ['stock','makhzen'],
      ans: '📦 Bach tdir stock :\nMenu → Stock → Bon d\'entrée / Bon de sortie' },
    { kw: ['bug','mochkil','ma khdamch','khrab','problem','erreur'],
      ans: '🛠️ Saker w 3awed iftah. Ila mzal → contacti support LOGICOM.' },
    { kw: ['essai','demo','gratuit','mjaani','njarreb'],
      ans: '🆓 T9addar tjarreb bla flous ! Contacti-na w ndirlak version demo.' },
];

function detectLanguage(text) {
    const t = text.toLowerCase();
    const dzSignals = ['wesh','wach','kifach','bezzaf','druk','dima','mochkil','flouss','salam','labess','rani','sahbi','3ndek','wakha','safi','mli7','mzyan'];
    const score = dzSignals.filter(s => t.includes(s)).length
        + ([...text].some(c => c >= '؀' && c <= 'ۿ') ? 3 : 0);
    return score >= 1 ? 'dz' : 'fr';
}

function detectSecteur(text) {
    const t = text.toLowerCase();
    return Object.keys(SECTEUR_KEYWORDS).find(s => SECTEUR_KEYWORDS[s].some(kw => t.includes(kw))) || null;
}

function formatPack(secteur, lang) {
    const packs = loadPacks();
    const p = packs[secteur];
    if (!p) return null;
    const inclus = p.inclus.map(i => `  ✅ ${i}`).join('\n');
    const text = lang === 'dz'
        ? `🎯 *${p.nom}*\n\n💰 Prix : *${p.prix} DA*\n\nChnou kayen f-pack :\n${inclus}\n\nContacti-na bach tachri ! 📞`
        : `🎯 *${p.nom}*\n\n💰 Prix : *${p.prix} DA*\n\nCe pack inclut :\n${inclus}\n\nContactez-nous pour acheter ! 📞`;
    return { text, youtube: p.youtube };
}

function findFaq(text) {
    const t = text.toLowerCase();
    return FAQ.find(e => e.kw.some(k => t.includes(k))) || null;
}

function askGroq(userMessage, history) {
    return new Promise((resolve, reject) => {
        const messages = [
            { role: 'system', content: GROQ_SYSTEM_PROMPT },
            ...history.slice(-8),
            { role: 'user', content: userMessage }
        ];
        const body = JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 350, messages });
        const req = https.request({
            hostname: 'api.groq.com',
            path: '/openai/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + getGroqKey(),
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data).choices?.[0]?.message?.content || '...'); }
                catch(e) { reject(new Error(data)); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function sendWithYoutube(bot, chatId, text, youtube) {
    const opts = { parse_mode: 'Markdown' };
    if (youtube) opts.reply_markup = { inline_keyboard: [[{ text: '▶️ Voir tutoriel', url: youtube }]] };
    return bot.sendMessage(chatId, text, opts);
}

// ── Main bot startup ─────────────────────────────────────────────────────────
async function startBot() {
    await initDB();

    const token = getBotToken();
    if (!token) {
        console.error('[Bot] No token in bot-config.json. Set it and restart.');
        process.exit(1);
    }

    console.log('[Bot] Starting standalone Telegram bot...');

    const bot = new TelegramBot(token, {
        polling: { interval: 1000, autoStart: true, params: { timeout: 10 } }
    });

    bot.on('polling_error', (err) => {
        if (err.message?.includes('409')) {
            console.warn('[Bot] 409 conflict — retrying in 15s...');
            bot.stopPolling().catch(() => {});
            setTimeout(() => bot.startPolling().catch(() => {}), 15000);
            return;
        }
        console.error('[Bot] Polling error:', err.message);
    });

    const userStates   = {};
    const chatHistories = {};

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text   = msg.text;
        if (!text) return;

        try {
            const lang  = detectLanguage(text);
            const state = userStates[chatId];

            // ── /start /help ────────────────────────────────────────────────
            if (text === '/start' || text === '/help') {
                const welcome = lang === 'dz'
                    ? `👋 *Salam ! Marhba bik f LOGICOM* 🇩🇿\n\nChnou naw3 l-activité taa3ak ?\n\n🏪 Supérette  💊 Pharmacie  🥖 Boulangerie\n🔧 Quincaillerie  🏭 Industrie  🍕 Restaurant\n\nWella soel s-so2al taa3ak ! 😊`
                    : `👋 *Bonjour ! Bienvenue chez LOGICOM* 🇩🇿\n\nQuel type d'activité avez-vous ?\n\n🏪 Supérette  💊 Pharmacie  🥖 Boulangerie\n🔧 Quincaillerie  🏭 Industrie  🍕 Restaurant\n\nOu posez directement votre question ! 😊`;
                bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown' });
                return;
            }

            // ── /reset ───────────────────────────────────────────────────────
            if (text === '/reset') {
                delete chatHistories[chatId];
                bot.sendMessage(chatId, lang === 'dz' ? '🔄 صافي! واش عندك سؤال جديد؟' : '🔄 Historique effacé !');
                return;
            }

            // ── /rappel ──────────────────────────────────────────────────────
            if (text === '/rappel') {
                bot.sendMessage(chatId, `🔔 *RAPPELS IMPAYÉS*\n\nChoisissez la période :`, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [
                        [{ text: '1 mois', callback_data: 'rappel_30' }, { text: '3 mois', callback_data: 'rappel_90' }],
                        [{ text: '6 mois', callback_data: 'rappel_180' }, { text: 'Tous', callback_data: 'rappel_0' }],
                    ]}
                });
                return;
            }

            // ── /nouveau ─────────────────────────────────────────────────────
            if (text === '/nouveau' || text.toLowerCase() === 'nouveau') {
                userStates[chatId] = { step: 'WAITING_TYPE', data: {} };
                bot.sendMessage(chatId,
                    `🆕 *NOUVEAU CLIENT — ÉTAPE 1/6*\n\nC'est un client *nouveau* ou *existant* ?`,
                    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
                        [{ text: '✨ Nouveau Client', callback_data: 'type_nouveau' }],
                        [{ text: '🔄 Client Existant', callback_data: 'type_existant' }]
                    ]}}
                );
                return;
            }

            // ── WIZARD ───────────────────────────────────────────────────────
            if (state) {
                if (state.step === 'WAITING_TYPE') {
                    state.data.category = text.toLowerCase().includes('exist') ? 'Existant' : 'Nouveau';
                    state.step = 'WAITING_NAME';
                    bot.sendMessage(chatId, `👤 *ÉTAPE 2/6*\nNom complet du client ?`, { parse_mode: 'Markdown', reply_markup: { force_reply: true } });
                    return;
                }
                if (state.step === 'WAITING_NAME') {
                    state.data.name = text.trim();
                    state.step = 'WAITING_PHONE';
                    bot.sendMessage(chatId, `📞 *ÉTAPE 3/6*\nNuméro de téléphone ?`, { parse_mode: 'Markdown', reply_markup: { force_reply: true } });
                    return;
                }
                if (state.step === 'WAITING_PHONE') {
                    const phone = text.replace(/\s/g, '');
                    if (!phone.match(/^\d{8,14}$/)) {
                        bot.sendMessage(chatId, '❌ Numéro invalide ! Ex: 0661223344', { reply_markup: { force_reply: true } });
                        return;
                    }
                    state.data.phone = phone;
                    state.step = 'WAITING_BRAND';
                    bot.sendMessage(chatId, `🏢 *ÉTAPE 4/6*\nMarque / Domaine ? (ou Non)`, { parse_mode: 'Markdown', reply_markup: { force_reply: true } });
                    return;
                }
                if (state.step === 'WAITING_BRAND') {
                    state.data.brand = text.toLowerCase() === 'non' ? '' : text.trim();
                    state.step = 'WAITING_PACK';
                    const packs = loadPacks();
                    const packLines = Object.values(packs).map(p => `• ${p.nom} — ${p.prix} DA`).join('\n');
                    bot.sendMessage(chatId, `📦 *ÉTAPE 5/6*\nQuel pack ?\n\n${packLines}\n\n(ou Non)`, { parse_mode: 'Markdown', reply_markup: { force_reply: true } });
                    return;
                }
                if (state.step === 'WAITING_PACK') {
                    state.data.pack = text.toLowerCase() === 'non' ? '' : text.trim();
                    state.step = 'WAITING_NOTE';
                    bot.sendMessage(chatId, `📝 *ÉTAPE 6/6*\nObservation ? (ou Non)`, { parse_mode: 'Markdown', reply_markup: { force_reply: true } });
                    return;
                }
                if (state.step === 'WAITING_NOTE') {
                    const note = text.toLowerCase() === 'non' ? '' : text.trim();
                    const { name, phone, brand, category, pack } = state.data;
                    const addedBy = msg.from.username || msg.from.first_name || 'Bot';
                    const fullNote = [pack ? `Pack: ${pack}` : '', note].filter(Boolean).join(' | ');
                    try {
                        addClient({ phone, name, brand, note: fullNote, addedBy, category });
                        bot.sendMessage(chatId,
                            `✅ *CLIENT ENREGISTRÉ !*\n\n👤 *Nom*: ${name}\n📞 *Tel*: ${phone}\n🏢 *Marque*: ${brand || '-'}\n📦 *Pack*: ${pack || '-'}\n📝 *Note*: ${note || '-'}\n\n➕ Ajouté par: @${addedBy}`,
                            { parse_mode: 'Markdown' }
                        );
                    } catch(e) {
                        bot.sendMessage(chatId, '❌ Erreur lors de l\'enregistrement.');
                    }
                    delete userStates[chatId];
                    return;
                }
            }

            // ── QUICK ADD: Nom - Phone - Brand ───────────────────────────────
            if (!state && text.includes('-')) {
                const parts = text.split('-').map(p => p.trim()).filter(Boolean);
                if (parts.length >= 2) {
                    const phoneIdx = parts.findIndex(p => p.replace(/\s/g,'').match(/^\d{8,14}$/));
                    if (phoneIdx !== -1) {
                        const phone   = parts[phoneIdx].replace(/\s/g,'');
                        const name    = phoneIdx === 0 ? (parts[1] || 'Client') : parts[0];
                        const brand   = parts[phoneIdx + 1] || '';
                        const note    = parts.slice(phoneIdx + 2).join(' - ') || '';
                        const addedBy = msg.from.username || msg.from.first_name || 'Bot';
                        try {
                            addClient({ phone, name, brand, note, addedBy });
                            bot.sendMessage(chatId, `✅ Client enregistré !\n👤 ${name} (${phone})`);
                        } catch(e) { bot.sendMessage(chatId, '❌ Erreur enregistrement'); }
                        return;
                    }
                }
            }

            // ── FAQ / PACK / GROQ ────────────────────────────────────────────
            if (!state) {
                const secteur = detectSecteur(text);
                if (secteur) {
                    const pack = formatPack(secteur, lang);
                    if (pack) { await sendWithYoutube(bot, chatId, pack.text, pack.youtube); return; }
                }

                const faq = findFaq(text);
                if (faq) {
                    if (faq.pack_query) {
                        bot.sendMessage(chatId, lang === 'dz'
                            ? '🏪 Chnou naw3 l-activité taa3ak ?\nSupérette / Pharmacie / Boulangerie / Quincaillerie / Industrie / Restaurant ?'
                            : '🏪 Quel est votre type d\'activité ?\nSupérette / Pharmacie / Boulangerie / Quincaillerie / Industrie / Restaurant ?');
                        return;
                    }
                    bot.sendMessage(chatId, faq.ans);
                    return;
                }

                // Payment promise detection
                try {
                    const safeChatId = String(chatId).replace(/[^0-9\-]/g, '');
                    const res = dbExec(`SELECT id, name, negotiatedPrice, paidAmount FROM clients WHERE telegramChatId='${safeChatId}' LIMIT 1`);
                    if (res.length && res[0].values.length) {
                        const c = {}; res[0].columns.forEach((col,i) => c[col] = res[0].values[0][i]);
                        const balance = Math.max(0, (c.negotiatedPrice||0) - (c.paidAmount||0));
                        if (balance > 0) {
                            const parsed = await parsePromiseWithGroq(text, getGroqKey());
                            if (parsed) {
                                savePaymentPromise(c.id, { promisedDate: parsed.promisedDate||'', promisedAmount: parsed.promisedAmount||0, promisedMethod: parsed.promisedMethod||'', promiseNote: parsed.promiseNote||text.slice(0,200) });
                                const confirm = `✅ Merci *${c.name}* !${parsed.promisedDate ? ` Date : *${parsed.promisedDate}*` : ''}${parsed.promisedAmount ? ` — *${parsed.promisedAmount.toLocaleString('fr-DZ')} DA*` : ''}\n\nBaraka Llaho fik 🙏`;
                                bot.sendMessage(chatId, confirm, { parse_mode: 'Markdown' });
                                const adminId = getAdminId();
                                if (adminId) bot.sendMessage(adminId, `🔔 *Promesse auto* — ${c.name}\n📅 ${parsed.promisedDate||'?'} — 💰 ${parsed.promisedAmount||'?'} DA`, { parse_mode: 'Markdown' });
                                return;
                            }
                        }
                    }
                } catch(e) {}

                // Groq fallback
                const groqKey = getGroqKey();
                if (groqKey) {
                    const history = chatHistories[chatId] || [];
                    bot.sendChatAction(chatId, 'typing');
                    try {
                        const reply = await askGroq(text, history);
                        history.push({ role: 'user', content: text });
                        history.push({ role: 'assistant', content: reply });
                        chatHistories[chatId] = history.slice(-20);
                        bot.sendMessage(chatId, reply);
                    } catch(e) { bot.sendMessage(chatId, '❌ خطأ تقني. Réessayez.'); }
                } else {
                    bot.sendMessage(chatId, lang === 'dz' ? '❓ Ma fhemtch. Contacti support LOGICOM.' : '❓ Je n\'ai pas compris. Contactez le support LOGICOM.');
                }
            }

        } catch(err) {
            console.error('[Bot] Error:', err.message);
            try { bot.sendMessage(chatId, '❌ Erreur interne. Réessayez.'); } catch(_) {}
        }
    });

    // ── Callback queries ─────────────────────────────────────────────────────
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const data   = query.data;
        await bot.answerCallbackQuery(query.id).catch(() => {});

        if (data === 'type_nouveau' || data === 'type_existant') {
            userStates[chatId] = { step: 'WAITING_NAME', data: { category: data === 'type_nouveau' ? 'Nouveau' : 'Existant' } };
            bot.sendMessage(chatId, `👤 *ÉTAPE 2/6*\nNom complet du client ?`, { parse_mode: 'Markdown', reply_markup: { force_reply: true } });
            return;
        }

        if (data.startsWith('rappel_')) {
            const days    = parseInt(data.split('_')[1]);
            const clients = getUnpaidClients(days === 0 ? 99999 : days);
            if (!clients.length) { bot.sendMessage(chatId, '✅ Aucun client impayé.'); return; }

            const label = days === 0 ? 'tous' : days <= 31 ? `${days} jours` : days <= 91 ? '3 mois' : '6 mois';
            userStates[chatId] = { step: 'RAPPEL_CONFIRM', data: { clients, label } };
            const lines = clients.slice(0,20).map((c,i) => `${i+1}. *${c.name}* — ${c.phone}${c.telegramChatId ? ' 📱' : ''}`).join('\n');
            bot.sendMessage(chatId,
                `🔔 *${clients.length} clients impayés* (${label}) :\n\n${lines}${clients.length > 20 ? `\n_...et ${clients.length-20} autres_` : ''}\n\nConfirmer l'envoi du rappel ?`,
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
                    [{ text: '📤 Envoyer à tous', callback_data: 'rappel_send' }],
                    [{ text: '❌ Annuler', callback_data: 'rappel_cancel' }],
                ]}}
            );
            return;
        }

        if (data === 'rappel_cancel') { delete userStates[chatId]; bot.sendMessage(chatId, '❌ Annulé.'); return; }

        if (data === 'rappel_send') {
            const st = userStates[chatId];
            if (!st || st.step !== 'RAPPEL_CONFIRM') return;
            const { clients } = st.data;
            delete userStates[chatId];
            let sent = 0, skipped = 0;
            for (const c of clients) {
                const msg = `👋 Bonjour *${c.name}* !\n\n📋 Un paiement est en attente chez *LOGICOM*.\n\n💰 Merci de nous contacter pour régulariser.\n\n📞 Support LOGICOM`;
                if (c.telegramChatId) {
                    try { await bot.sendMessage(c.telegramChatId, msg, { parse_mode: 'Markdown' }); sent++; } catch(e) { skipped++; }
                } else { skipped++; }
                await new Promise(r => setTimeout(r, 300));
            }
            bot.sendMessage(chatId, `✅ *Rappels envoyés !*\n\n📱 Telegram : *${sent}*\n⚠️ Non atteints : *${skipped}*`, { parse_mode: 'Markdown' });
            return;
        }
    });

    console.log('[Bot] ✅ Telegram bot running 24/7 !');

    // Graceful shutdown
    process.on('SIGINT',  () => { bot.stopPolling(); process.exit(0); });
    process.on('SIGTERM', () => { bot.stopPolling(); process.exit(0); });
}

startBot().catch(err => {
    console.error('[Bot] Fatal error:', err);
    process.exit(1);
});
