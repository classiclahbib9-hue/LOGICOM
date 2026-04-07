/**
 * WhatsApp integration using whatsapp-web.js.
 * Receives client messages and routes them through the AI agent.
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const { processMessage } = require('./agent/conversation-manager');
const { loadConfig } = require('./agent/config');
const { BrowserWindow, Notification } = require('electron');

let waClient = null;
let waStatus = 'disconnected'; // disconnected | qr | ready | error

function getStatus() { return waStatus; }

/**
 * Initialize WhatsApp client.
 * @param {Object} callbacks - { onQR(qrData), onReady(), onDisconnected() }
 */
function initWhatsApp(callbacks = {}) {
    const config = loadConfig();
    if (!config.whatsappEnabled) {
        console.log('WhatsApp bot is disabled in settings.');
        return;
    }

    if (waClient) {
        try { waClient.destroy(); } catch(e) {}
    }

    console.log('Initializing WhatsApp client...');
    waStatus = 'disconnected';

    try {
        waClient = new Client({
            authStrategy: new LocalAuth({ dataPath: require('electron').app.getPath('userData') + '/whatsapp-auth' }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });

        waClient.on('qr', (qr) => {
            console.log('WhatsApp QR code received. Scan to connect.');
            waStatus = 'qr';
            if (callbacks.onQR) callbacks.onQR(qr);
            // Notify all Electron windows
            BrowserWindow.getAllWindows().forEach(win => {
                win.webContents.send('whatsapp-qr', qr);
            });
        });

        waClient.on('ready', () => {
            console.log('WhatsApp client is ready!');
            waStatus = 'ready';
            if (callbacks.onReady) callbacks.onReady();
            BrowserWindow.getAllWindows().forEach(win => {
                win.webContents.send('whatsapp-status', 'ready');
            });
            if (Notification.isSupported()) {
                new Notification({
                    title: 'LOGICOM - WhatsApp Connecte ✅',
                    body: 'Le bot WhatsApp est maintenant actif et ecoute les messages.'
                }).show();
            }
        });

        waClient.on('disconnected', (reason) => {
            console.log('WhatsApp disconnected:', reason);
            waStatus = 'disconnected';
            if (callbacks.onDisconnected) callbacks.onDisconnected(reason);
            BrowserWindow.getAllWindows().forEach(win => {
                win.webContents.send('whatsapp-status', 'disconnected');
            });
        });

        waClient.on('message', async (msg) => {
            // Skip messages from ourselves or groups
            if (msg.fromMe) return;
            if (msg.from.includes('@g.us')) return; // skip group messages

            const text = msg.body;
            if (!text) return;

            const phone = msg.from.replace('@c.us', '');
            const contact = await msg.getContact().catch(() => null);
            const userName = contact?.pushname || contact?.name || phone;

            console.log(`WhatsApp message from ${userName} (${phone}): ${text.substring(0, 50)}...`);

            try {
                const response = await processMessage('whatsapp', phone, text, {
                    username: userName,
                    firstName: userName,
                    phone: phone
                });
                await msg.reply(response);
            } catch (err) {
                console.error('WhatsApp AI error:', err);
                await msg.reply("Desole, y'a eu un probleme. Renvoyez votre message SVP.");
            }
        });

        waClient.initialize();

    } catch (err) {
        console.error('WhatsApp initialization error:', err);
        waStatus = 'error';
    }
}

function destroyWhatsApp() {
    if (waClient) {
        try { waClient.destroy(); } catch(e) {}
        waClient = null;
        waStatus = 'disconnected';
    }
}

module.exports = { initWhatsApp, destroyWhatsApp, getStatus };
