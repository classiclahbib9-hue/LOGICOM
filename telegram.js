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

        bot.on('message', async (msg) => {
            const text = msg.text;
            if (!text) return;

            // Simple "is the bot alive?" check
            if (text.toLowerCase() === '/start' || text.toLowerCase() === 'help' || text.toLowerCase() === 'aide') {
                bot.sendMessage(msg.chat.id, '🤖 **BOT LOGICOM ACTIF**\n\nEnvoyez un message contenant :\n`06XXXXXXXX Nom Entreprise Note`\n\nLe bot détectera automatiquement le numéro et créera le client.');
                return;
            }

            const parts = text.split(/\s+/).filter(p => p.trim());
            if (parts.length === 0) return;

            // Find the first part that looks like a phone number (8 to 14 digits)
            const phoneIndex = parts.findIndex(p => p.match(/^\d{8,14}$/));
            
            if (phoneIndex === -1) {
                console.log('No phone number detected in message:', text);
                return;
            }

            const phone = parts[phoneIndex];
            let name = '', brand = '', note = '';

            // Everything before the phone is part of the name
            const beforePhone = parts.slice(0, phoneIndex);
            // Everything after the phone
            const afterPhone = parts.slice(phoneIndex + 1);

            if (beforePhone.length > 0) {
                name = beforePhone.join(' ');
            }

            if (afterPhone.length > 0) {
                // If it contains a separator like '-' or '|', use it for Note
                const afterText = afterPhone.join(' ');
                const separatorMatch = afterText.match(/[-|]/);
                
                if (separatorMatch) {
                    const sep = separatorMatch[0];
                    const splitAfter = afterText.split(sep).map(s => s.trim());
                    if (!name) name = splitAfter[0];
                    else brand = splitAfter[0];
                    note = splitAfter.slice(1).join(` ${sep} `);
                } else {
                    // No separator: assume Last Word is Brand, middle words are Name (if name not set)
                    if (!name) {
                        if (afterPhone.length === 1) {
                            name = afterPhone[0];
                        } else {
                            brand = afterPhone[afterPhone.length - 1];
                            name = afterPhone.slice(0, afterPhone.length - 1).join(' ');
                        }
                    } else {
                        // Name already set from beforePhone, so everything after is Brand + Note
                        brand = afterPhone[0];
                        note = afterPhone.slice(1).join(' ');
                    }
                }
            }

            if (!name) name = 'Client ' + phone;

            console.log('Telegram sync detected:', { phone, name, brand, note });
            
            try {
                await addClientManually({ phone, name, brand, note });
                bot.sendMessage(msg.chat.id, `✅ **Client Synchronisé !**\n\n📞 **Tel**: ${phone}\n👤 **Nom**: ${name}\n🏢 **Domaine**: ${brand || '-'}\n📝 **Note**: ${note || '-'}`);
            } catch (err) {
                console.error('Error saving client from Telegram:', err);
                bot.sendMessage(msg.chat.id, '❌ Erreur lors de la synchronisation avec la base de données.');
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

