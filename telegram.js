const TelegramBot = require('node-telegram-bot-api');
const { addClientManually } = require('./db');
const { processMessage } = require('./agent/conversation-manager');
const { loadConfig: loadAgentConfig } = require('./agent/config');
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

        bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const text = msg.text;
            if (!text) return;

            // --- /start or /help ---
            if (text === '/start' || text.toLowerCase().includes('aide') || text === '/help') {
                bot.sendMessage(chatId,
                    `🤖 *MERHBA BIK F LOGICOM!* 🤖\n\n` +
                    `Ana l'assistant automatique dyal DELFI. Goulili wach t7eb t3ref 3la LOGICOM!\n\n` +
                    `Tqder aussi t'envoye directement :\n` +
                    `\`NOM - TEL - MARQUE - NOTE\``,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            // --- Single-message shortcut (NOM - TEL - MARQUE - NOTE) ---
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
                            await addClientManually({ phone, name, brand, note, addedBy, source: 'Telegram' });
                            bot.sendMessage(chatId, `✅ *Tsjelt ya ${name}!*\n👤 ${name} (${phone})\nL'equipe ghadi yt3awdou m3ak!`, { parse_mode: 'Markdown' });
                        } catch (e) {
                            bot.sendMessage(chatId, "❌ Erreur technique. Renvoyez SVP.");
                        }
                        return;
                    }
                }
            }

            // --- AI Agent (all other messages) ---
            const agentConfig = loadAgentConfig();
            if (agentConfig.claudeApiKey) {
                try {
                    bot.sendChatAction(chatId, 'typing');
                    const userInfo = {
                        username: msg.from.username || msg.from.first_name || 'Inconnu',
                        firstName: msg.from.first_name || '',
                        phone: ''
                    };
                    const response = await processMessage('telegram', chatId, text, userInfo);
                    bot.sendMessage(chatId, response, { parse_mode: 'Markdown' }).catch(() => {
                        // Retry without markdown if it fails
                        bot.sendMessage(chatId, response);
                    });
                } catch (e) {
                    console.error('Telegram AI error:', e);
                    bot.sendMessage(chatId, "❌ Erreur technique. Renvoyez votre message SVP.");
                }
            } else {
                // Fallback when no Claude API key is set
                bot.sendMessage(chatId,
                    "Merhba! L'assistant IA mch disponible dork.\n" +
                    "Envoyez: `NOM - TEL - MARQUE` pour vous inscrire.",
                    { parse_mode: 'Markdown' }
                );
            }
        });

        console.log('Telegram Bot is now polling (AI-powered)...');
    } catch (err) {
        console.error('Critical Telegram initialization error:', err);
    }
}

function updateConfig(newConfig) {
    const configPath = getConfigPath();
    const tmpPath = configPath + '.tmp';
    try {
        fs.writeFileSync(tmpPath, JSON.stringify(newConfig, null, 2), 'utf8');
        fs.renameSync(tmpPath, configPath);   // atomic replace
    } catch (err) {
        console.error('Failed to save Telegram config:', err);
        try { fs.unlinkSync(tmpPath); } catch (e) {}
        throw err;
    }
    initTelegram();
}

module.exports = { initTelegram, updateConfig };
