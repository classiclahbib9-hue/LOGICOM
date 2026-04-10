const TelegramBot = require('node-telegram-bot-api');
const { addClientManually } = require('./db');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { app, Notification } = require('electron');

const GROQ_SYSTEM_PROMPT = `أنت مساعد ذكي يفهم ويتكلم الدارجة المغربية والجزائرية والفرنسية.
تعمل لدى شركة LOGICOM لبيع البرمجيات.
جاوب دايما بالدارجة حسب لغة المستخدم. إذا كلمك بالفرنسية، جاوبه بالفرنسية.
كون مختصر ومفيد. لا تكتب إجابات طويلة.
الأوامر المتاحة في البوت: /nouveau لإضافة عميل.`;

function getGroqKey() {
    try {
        const configPath = path.join(app.getPath('userData'), 'telegram-config.json');
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf8')).groqApiKey || '';
        }
    } catch(e) {}
    return '';
}

function downloadBuffer(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
    });
}

function transcribeVoice(audioBuffer) {
    return new Promise((resolve, reject) => {
        const boundary = 'Boundary' + Date.now();
        const header = Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.ogg"\r\nContent-Type: audio/ogg\r\n\r\n`
        );
        const footer = Buffer.from(
            `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo` +
            `\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nar` +
            `\r\n--${boundary}--\r\n`
        );
        const body = Buffer.concat([header, audioBuffer, footer]);
        const req = https.request({
            hostname: 'api.groq.com',
            path: '/openai/v1/audio/transcriptions',
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + getGroqKey(),
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data).text || ''); }
                catch(e) { reject(new Error(data)); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function askGroq(userMessage, history) {
    return new Promise((resolve, reject) => {
        const messages = [
            { role: 'system', content: GROQ_SYSTEM_PROMPT },
            ...history.slice(-8),
            { role: 'user', content: userMessage }
        ];
        const body = JSON.stringify({ model: 'llama-3.1-8b-instant', max_tokens: 300, messages });
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
                try {
                    const json = JSON.parse(data);
                    resolve(json.choices?.[0]?.message?.content || '...');
                } catch(e) { reject(new Error(data)); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function getConfigPath() {
    return path.join(app.getPath('userData'), 'telegram-config.json');
}

let currentBot = null;

function initTelegram() {
    let config = { token: '', active: false };
    const configPath = getConfigPath();

    if (fs.existsSync(configPath)) {
        try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (e) {
            console.error('Error reading telegram config:', e);
        }
    }

    if (!config.token) {
        console.log('Telegram Bot Token not set. Please set it in the settings.');
        return;
    }

    if (currentBot) {
        try {
            currentBot.stopPolling();
        } catch (e) {}
    }

    console.log('Initializing Telegram Bot with token:', config.token.substring(0, 5) + '...');
    
    try {
        const bot = new TelegramBot(config.token, { polling: true });
        currentBot = bot;

        bot.on('polling_error', (error) => {
            console.error('Telegram Polling Error:', error.code, error.message);
        });

        const userStates = {}; // chatId -> { step: string, data: {} }
        const chatHistories = {}; // chatId -> [{role, content}]

        bot.on('message', async (msg) => {
            const chatId = msg.chat.id;

            // --- VOICE MESSAGE ---
            if (msg.voice) {
                const groqKey = getGroqKey();
                if (!groqKey) { bot.sendMessage(chatId, "⚙️ Groq API Key manquante."); return; }
                bot.sendChatAction(chatId, 'typing');
                try {
                    const fileLink = await bot.getFileLink(msg.voice.file_id);
                    const audioBuffer = await downloadBuffer(fileLink);
                    const transcribed = await transcribeVoice(audioBuffer);
                    if (!transcribed) { bot.sendMessage(chatId, "❌ ما فهمتش الصوت، عاود مرة أخرى."); return; }
                    const history = chatHistories[chatId] || [];
                    const reply = await askGroq(transcribed, history);
                    history.push({ role: 'user', content: transcribed });
                    history.push({ role: 'assistant', content: reply });
                    chatHistories[chatId] = history.slice(-16);
                    bot.sendMessage(chatId, `🎙️ _"${transcribed}"_\n\n${reply}`, { parse_mode: 'Markdown' });
                } catch(e) {
                    bot.sendMessage(chatId, "❌ خطأ في الصوت: " + e.message);
                }
                return;
            }

            const text = msg.text;
            if (!text) return;

            // --- COMMANDS ---
            if (text === '/start' || text.toLowerCase().includes('aide') || text === '/help') {
                bot.sendMessage(chatId, 
                    `🤖 **BIENVENUE CHEZ LOGICOM** 🤖\n\n` +
                    `Appuyez sur /nouveau pour ajouter un client étape par étape, ou envoyez directement :\n` +
                    `\`NOM - TEL - MARQUE - NOTE\``
                );
                return;
            }

            if (text === '/nouveau' || text.toLowerCase() === 'nouveau') {
                userStates[chatId] = { step: 'WAITING_NAME', data: {} };
                bot.sendMessage(chatId, "👤 **ÉTAPE 1/4**\nQuel est le **NOM COMPLET** du client ?", {
                    reply_markup: { force_reply: true }
                });
                return;
            }

            // --- WIZARD STATE MACHINE ---
            const state = userStates[chatId];
            if (state && msg.reply_to_message) {
                if (state.step === 'WAITING_NAME') {
                    state.data.name = text.trim();
                    state.step = 'WAITING_PHONE';
                    bot.sendMessage(chatId, "📞 **ÉTAPE 2/4**\nQuel est son **NUMÉRO DE TÉLÉPHONE** ?", {
                        reply_markup: { force_reply: true }
                    });
                    return;
                }
                
                if (state.step === 'WAITING_PHONE') {
                    const phone = text.replace(/\s/g, '');
                    if (!phone.match(/^\d{8,14}$/)) {
                        bot.sendMessage(chatId, "❌ **Numéro invalide !**\nVeuillez entrer entre 8 et 14 chiffres (ex: 0661223344).", {
                            reply_markup: { force_reply: true }
                        });
                        return;
                    }
                    state.data.phone = phone;
                    state.step = 'WAITING_BRAND';
                    bot.sendMessage(chatId, "🏢 **ÉTAPE 3/4**\nQuelle est la **MARQUE / DOMAINE** ? (ou tapez 'Non' )", {
                        reply_markup: { force_reply: true }
                    });
                    return;
                }

                if (state.step === 'WAITING_BRAND') {
                    state.data.brand = (text.toLowerCase() === 'non') ? '' : text.trim();
                    state.step = 'WAITING_NOTE';
                    bot.sendMessage(chatId, "📝 **ÉTAPE 4/4**\nUne **OBSERVATION** ? (ou tapez 'Non')", {
                        reply_markup: { force_reply: true }
                    });
                    return;
                }

                if (state.step === 'WAITING_NOTE') {
                    const note = (text.toLowerCase() === 'non') ? '' : text.trim();
                    const name = state.data.name;
                    const phone = state.data.phone;
                    const brand = state.data.brand;
                    const addedBy = msg.from.username || msg.from.first_name || 'Inconnu';

                    try {
                        await addClientManually({ phone, name, brand, note, addedBy });
                        bot.sendMessage(chatId, 
                            `✅ **CLIENT ENREGISTRÉ AVEC SUCCÈS !**\n\n` +
                            `👤 **Nom**: ${name}\n` +
                            `📞 **Tel**: ${phone}\n` +
                            `🏢 **Marque**: ${brand || '-'}\n` +
                            `📝 **Note**: ${note || '-'}\n\n` +
                            `👤 **Ajouté par**: @${addedBy}`,
                            { parse_mode: 'Markdown' }
                        );
                    } catch (e) {
                        bot.sendMessage(chatId, "❌ Erreur technique lors de l'enregistrement.");
                    }
                    delete userStates[chatId];
                    return;
                }
            }

            // --- SINGLE MESSAGE SHORTCUT ---
            if (text.includes('-')) {
                const parts = text.split('-').map(p => p.trim()).filter(p => p);
                if (parts.length >= 2) {
                    const phoneIdx = parts.findIndex(p => p.replace(/\s/g, '').match(/^\d{8,14}$/));
                    if (phoneIdx !== -1) {
                        const phone = parts[phoneIdx].replace(/\s/g, '');
                        const name = (phoneIdx === 0) ? (parts[1] || 'Client') : parts[0];
                        const brand = parts[phoneIdx + 1] || '';
                        const note = parts.slice(phoneIdx + 2).join(' - ') || '';
                        const addedBy = msg.from.username || msg.from.first_name || 'Inconnu';
                        
                        try {
                            await addClientManually({ phone, name, brand, note, addedBy });
                            bot.sendMessage(chatId, `✅ **Rapide : Client Enregistré !**\n👤 ${name} (${phone})`);
                        } catch (e) {
                            bot.sendMessage(chatId, "❌ Erreur (Sync Rapide)");
                        }
                        return;
                    }
                }
            }

            // --- DEFAULT FALLBACK: ask Groq ---
            if (!state) {
                const groqKey = getGroqKey();
                if (!groqKey) {
                    bot.sendMessage(chatId, "❓ Je n'ai pas compris.\nTapez /nouveau pour démarrer la saisie guidée.");
                    return;
                }
                const history = chatHistories[chatId] || [];
                bot.sendChatAction(chatId, 'typing');
                try {
                    const reply = await askGroq(text, history);
                    history.push({ role: 'user', content: text });
                    history.push({ role: 'assistant', content: reply });
                    chatHistories[chatId] = history.slice(-16);
                    bot.sendMessage(chatId, reply);
                } catch(e) {
                    bot.sendMessage(chatId, "❌ خطأ تقني: " + e.message);
                }
            }
        });

        console.log('Telegram Bot is now polling...');
    } catch (err) {
        console.error('Critical Telegram initialization error:', err);
    }
}

function updateConfig(newConfig) {
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(newConfig));
    initTelegram();
}

module.exports = { initTelegram, updateConfig };

