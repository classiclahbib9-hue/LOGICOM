const TelegramBot = require('node-telegram-bot-api');
const { addClientManually } = require('./db');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const configPath = path.join(app.getPath('userData'), 'telegram-config.json');
let currentBot = null;

function initTelegram() {
    let config = { token: '', active: false };
    if (fs.existsSync(configPath)) {
        try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (e) {}
    }

    if (!config.token) {
        console.log('Telegram Bot Token not set. Please set it in the settings.');
        return;
    }

    if (currentBot) {
        currentBot.stopPolling();
    }

    const bot = new TelegramBot(config.token, { polling: true });
    currentBot = bot;

    bot.on('message', async (msg) => {
        const text = msg.text;
        if (!text) return;

        const parts = text.split(/\s+/).filter(p => p.trim());
        if (parts.length === 0) return;

        let phone = '', name = '', brand = '';

        // First part is always assumed to be the phone number
        phone = parts[0];
        if (!phone.match(/^\d{8,14}$/)) return;

        // Try to find a separator (comma, hyphen, or pipe)
        let rest = text.substring(text.indexOf(phone) + phone.length).trim();
        const separator = rest.match(/[,|-]/);
        
        if (separator) {
            const splitChar = separator[0];
            const nameBrand = rest.split(splitChar);
            name = nameBrand[0].trim();
            brand = nameBrand[1] ? nameBrand[1].trim() : '';
        } else {
            // Default: PHONE NAME... BRAND
            const words = rest.split(/\s+/).filter(w => w.trim());
            if (words.length === 1) {
                name = words[0];
            } else if (words.length > 1) {
                brand = words[words.length - 1];
                name = words.slice(0, words.length - 1).join(' ');
            } else {
                name = 'Nouveau Client Telegram';
            }
        }
        
        if (phone) {
            console.log('Final Parsed Client:', { phone, name, brand });
            await addClientManually({ phone, name, brand });
            bot.sendMessage(msg.chat.id, `✅ Client Synchronisé !\n👤 **Nom**: ${name}\n📞 **Tel**: ${phone}\n🏢 **Domaine**: ${brand || '-'}`);
        }
    });

    console.log('Telegram Bot initialized!');
}

function updateConfig(newConfig) {
    fs.writeFileSync(configPath, JSON.stringify(newConfig));
    initTelegram();
}

module.exports = { initTelegram, updateConfig };
