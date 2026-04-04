const TelegramBot = require('node-telegram-bot-api');
const { addClientManually } = require('./db');
const fs = require('fs');
const path = require('path');
const { app, Notification } = require('electron');

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

        bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
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

            // --- DEFAULT FALLBACK ---
            if (!state) {
                bot.sendMessage(chatId, "❓ Je n'ai pas compris.\nTapez /nouveau pour démarrer la saisie guidée.");
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

