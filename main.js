const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path')
const fs = require('fs')
const { initDB, registerIpcHandlers, getDB, getSoldClients, savePaymentPromise, getDuePromises } = require('./db')
const { initTelegram } = require('./telegram')
const { initWhatsApp } = require('./whatsapp')
const { startApiServer, generateKey, loadKeys, saveKeys } = require('./api-server')

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  mainWindow.loadFile('index.html')
}

ipcMain.handle('generate-pdf-auto', async (event, { html, filename }) => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  
  const fullHtml = `
    <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline';">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 0; margin: 0; color: #1e293b; line-height: 1.5; }
          .preview-page { width: 100%; padding: 40px; box-sizing: border-box; }
          .preview-header { display: flex; justify-content: space-between; border-bottom: 2px solid #f1f5f9; padding-bottom: 30px; margin-bottom: 40px; }
          .preview-logo-area { display: flex; align-items: center; gap: 12px; }
          .preview-logo-icon { width: 40px; height: 40px; object-fit: contain; }
          .preview-logo-text { font-size: 24px; font-weight: 800; color: #0f172a; }
          .preview-logo-text span { color: #1a4fa0; }
          .preview-title-area { text-align: right; }
          .preview-title { font-size: 32px; font-weight: 800; color: #0f172a; margin-bottom: 8px; text-transform: uppercase; }
          .preview-subtitle { font-size: 14px; color: #64748b; }
          .preview-info { display: flex; justify-content: space-between; margin-bottom: 40px; gap: 40px; }
          .preview-info-box h4 { font-size: 12px; text-transform: uppercase; color: #1a4fa0; margin-bottom: 12px; letter-spacing: 1.5px; border-bottom: 2px solid #f1f5f9; padding-bottom: 5px; }
          .preview-info-box p { font-size: 14px; line-height: 1.6; color: #334155; margin: 0; }
          .preview-table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
          .preview-table th { background: #f8fafc; padding: 14px 15px; text-align: left; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
          .preview-table td { padding: 14px 15px; border-bottom: 1px solid #f1f5f9; font-size: 14px; color: #1e293b; }
          .preview-total-box { margin-left: auto; width: 320px; background: #0f172a; color: white; padding: 25px; border-radius: 12px; }
          .preview-total-row { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; color: #cbd5e1; }
          .preview-grand-total { border-top: 1px solid #334155; margin-top: 15px; padding-top: 15px; display: flex; flex-direction: column; }
          .preview-grand-total-label { font-size: 11px; text-transform: uppercase; margin-bottom: 5px; color: #94a3b8; }
          .preview-grand-total-value { font-size: 24px; font-weight: 800; }
          .bank-details { font-size: 13px; line-height: 1.6; color: #334155; }
          .preview-footer-layout { display: flex; justify-content: space-between; align-items: flex-start; }
          .preview-status-badge { display: inline-block; padding: 4px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-top: 5px; }
          .status-regle { background: #dcfce7; color: #166534; }
          .status-verser { background: #fef9c3; color: #854d0e; }
          .status-non { background: #fee2e2; color: #991b1b; }
          .category-row td { background: #f8fafc !important; font-weight: 700; color: #1e293b; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="preview-page">
          ${html}
        </div>
      </body>
    </html>
  `;

  const base64Html = Buffer.from(fullHtml, 'utf8').toString('base64');
  await win.loadURL(`data:text/html;charset=UTF-8;base64,${base64Html}`);
  
  const data = await win.webContents.printToPDF({
    printBackground: true,
    marginsType: 0,
    pageSize: 'A4'
  });

  const docsPath = path.join(app.getPath('documents'), 'LOGICOM');
  if (!fs.existsSync(docsPath)) fs.mkdirSync(docsPath, { recursive: true });

  const filePath = path.join(docsPath, filename);
  fs.writeFileSync(filePath, data);
  win.close();
  return filePath;
});

ipcMain.handle('generate-pdf', async (event, { html, filename }) => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  
  // Use the same robust template as generate-pdf-auto
  const fullHtml = `
    <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline';">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 0; margin: 0; color: #1e293b; line-height: 1.5; }
          .preview-page { width: 100%; padding: 40px; box-sizing: border-box; }
          .preview-header { display: flex; justify-content: space-between; border-bottom: 2px solid #f1f5f9; padding-bottom: 30px; margin-bottom: 40px; }
          .preview-logo-area { display: flex; align-items: center; gap: 12px; }
          .preview-logo-icon { width: 40px !important; height: 40px !important; object-fit: contain; }
          .preview-logo-text { font-size: 24px; font-weight: 800; color: #0f172a; }
          .preview-logo-text span { color: #1a4fa0; }
          .preview-title-area { text-align: right; }
          .preview-title { font-size: 32px; font-weight: 800; color: #0f172a; margin-bottom: 8px; text-transform: uppercase; }
          .preview-subtitle { font-size: 14px; color: #64748b; }
          .preview-info { display: flex; justify-content: space-between; margin-bottom: 40px; gap: 40px; }
          .preview-info-box h4 { font-size: 12px; text-transform: uppercase; color: #1a4fa0; margin-bottom: 12px; letter-spacing: 1.5px; border-bottom: 2px solid #f1f5f9; padding-bottom: 5px; }
          .preview-info-box p { font-size: 14px; line-height: 1.6; color: #334155; margin: 0; }
          .preview-table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
          .preview-table th { background: #f8fafc; padding: 14px 15px; text-align: left; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
          .preview-table td { padding: 14px 15px; border-bottom: 1px solid #f1f5f9; font-size: 14px; color: #1e293b; }
          .preview-total-box { margin-left: auto; width: 320px; background: #0f172a; color: white; padding: 25px; border-radius: 12px; }
          .preview-total-row { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; color: #cbd5e1; }
          .preview-grand-total { border-top: 1px solid #334155; margin-top: 15px; padding-top: 15px; display: flex; flex-direction: column; }
          .preview-grand-total-label { font-size: 11px; text-transform: uppercase; margin-bottom: 5px; color: #94a3b8; }
          .preview-grand-total-value { font-size: 24px; font-weight: 800; }
          .bank-details { font-size: 13px; line-height: 1.6; color: #334155; }
          .preview-footer-layout { display: flex; justify-content: space-between; align-items: flex-start; }
          .status-regle { background: #dcfce7; color: #166534; }
          .status-verser { background: #fef9c3; color: #854d0e; }
          .status-non { background: #fee2e2; color: #991b1b; }
          .category-row td { background: #f8fafc !important; font-weight: 700; color: #1e293b; font-size: 12px; }
        </style>
      </head>
      <body><div class="preview-page">${html}</div></body>
    </html>
  `;
  
  const base64Html = Buffer.from(fullHtml, 'utf8').toString('base64');
  await win.loadURL(`data:text/html;charset=UTF-8;base64,${base64Html}`);
  
  const data = await win.webContents.printToPDF({ printBackground: true, marginsType: 0, pageSize: 'A4' });
  const { filePath } = await dialog.showSaveDialog({ defaultPath: filename, filters: [{ name: 'PDF Files', extensions: ['pdf'] }] });
  
  if (filePath) { 
    fs.writeFileSync(filePath, data); 
    win.close(); 
    return filePath; 
  }
  win.close(); 
  return null;
});

// ── BULK SEND TO SOLD CLIENTS ────────────────────────────────────────────────
ipcMain.handle('save-payment-promise', async (_e, { clientId, promisedDate, promisedAmount, promisedMethod, promiseNote }) => {
  return savePaymentPromise(clientId, { promisedDate, promisedAmount, promisedMethod, promiseNote });
});

ipcMain.handle('get-due-promises', async () => {
  return getDuePromises();
});

ipcMain.handle('get-sold-clients', async (event, { filter }) => {
  return getSoldClients(filter || 'all');
});

ipcMain.handle('bulk-send-sold-message', async (event, { filter, template, channel }) => {
  const { sendWhatsApp, isWhatsAppReady } = require('./whatsapp');
  const { getBot } = require('./telegram');
  const tgBot = getBot();

  const clients = getSoldClients(filter || 'all');
  let sentWA = 0, sentTG = 0, failedWA = 0, failedTG = 0;

  for (const c of clients) {
    const msg = template
      .replace(/\{name\}/g, c.name || '')
      .replace(/\{phone\}/g, c.phone || '')
      .replace(/\{brand\}/g, c.brand || '')
      .replace(/\{pack\}/g, c.brand || '')
      .replace(/\{balance\}/g, Math.max(0, (c.negotiatedPrice || 0) - (c.paidAmount || 0)));

    const waReady2 = isWhatsAppReady() && !!c.phone;
    const tgReady2 = !!(tgBot && c.telegramChatId);

    if ((channel === 'tg' || channel === 'both') && tgReady2) {
      try { await tgBot.sendMessage(c.telegramChatId, msg); sentTG++; }
      catch(e) { failedTG++; }
    }

    const needWA2 = channel === 'wa' || channel === 'both' || (channel === 'tg' && !tgReady2);
    if (needWA2 && waReady2) {
      try { await sendWhatsApp(c.phone, msg); sentWA++; await new Promise(r => setTimeout(r, 500)); }
      catch(e) { failedWA++; }
    }

    await new Promise(r => setTimeout(r, 300));
  }

  return { total: clients.length, sentWA, sentTG, failedWA, failedTG };
});

ipcMain.handle('open-whatsapp', async (event, url) => {
  return shell.openExternal(url);
});

ipcMain.handle('bulk-send-reminder-message', async (event, { clientIds, template, channel }) => {
  const { sendWhatsApp, isWhatsAppReady } = require('./whatsapp');
  const { getBot } = require('./telegram');
  const tgBot = getBot();
  const db = getDB();

  const idList = clientIds.map(id => parseInt(id)).join(',');
  const res = db.exec(`SELECT id, name, phone, brand, negotiatedPrice, paidAmount, telegramChatId FROM clients WHERE id IN (${idList})`);
  const rows = res.length ? res[0].values.map(row => {
    const obj = {};
    res[0].columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  }) : [];

  let sentWA = 0, sentTG = 0, failedWA = 0, failedTG = 0;

  for (const c of rows) {
    const total = c.negotiatedPrice || 0;
    const paid  = c.paidAmount || 0;
    const balance = Math.max(0, total - paid);
    const msg = template
      .replace(/\{name\}/g, c.name || '')
      .replace(/\{phone\}/g, c.phone || '')
      .replace(/\{brand\}/g, c.brand || '')
      .replace(/\{balance\}/g, balance.toLocaleString('fr-DZ'));

    const waReady = isWhatsAppReady() && !!c.phone;
    const tgReady = !!(tgBot && c.telegramChatId);

    // Telegram send
    if ((channel === 'tg' || channel === 'both') && tgReady) {
      try { await tgBot.sendMessage(c.telegramChatId, msg); sentTG++; }
      catch(e) { failedTG++; }
    }

    // WhatsApp send — also used as fallback when TG requested but client has no chatId
    const needWA = channel === 'wa' || channel === 'both' || (channel === 'tg' && !tgReady);
    if (needWA && waReady) {
      try { await sendWhatsApp(c.phone, msg); sentWA++; await new Promise(r => setTimeout(r, 600)); }
      catch(e) { failedWA++; }
    }

    await new Promise(r => setTimeout(r, 300));
  }

  return { total: rows.length, sentWA, sentTG, failedWA, failedTG };
});

ipcMain.handle('send-whatsapp-with-file', async (event, { phone, message, filePath }) => {
  // 1. Copy file to clipboard using a more robust PowerShell method (FileDropList)
  if (filePath && fs.existsSync(filePath)) {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    const escapedPath = filePath.replace(/'/g, "''"); // Escape single quotes for PowerShell
    const copyCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $list = New-Object System.Collections.Specialized.StringCollection; $list.Add('${escapedPath}'); [System.Windows.Forms.Clipboard]::SetFileDropList($list); Set-Clipboard -Path '${escapedPath}'"`;
    
    try {
      await execPromise(copyCmd);
    } catch (e) {
      console.error('Clipboard copy failed:', e);
    }
  }

  // 2. Open WhatsApp chat
  const url = `whatsapp://send?phone=${phone}&text=${encodeURIComponent(message)}`;
  shell.openExternal(url);

  // 3. Automation through a temporary VBScript + PowerShell for better window targeting
  if (filePath) {
    setTimeout(() => {
      const psScript = `
        $code = @'
            using System;
            using System.Runtime.InteropServices;
            using System.Text;
            public class Win32 {
                [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
                public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
                [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
                [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
                [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
                [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);
            }
'@
        Add-Type -TypeDefinition $code
        
        $targetHWnd = [IntPtr]::Zero
        $enumProc = [Win32+EnumWindowsProc] {
            param($hWnd, $lParam)
            $sb = New-Object System.Text.StringBuilder 256
            [Win32]::GetWindowText($hWnd, $sb, $sb.Capacity)
            if ($sb.ToString() -like "*WhatsApp*") {
                $script:targetHWnd = $hWnd
                return $false # Stop enumerating
            }
            return $true
        }

        $count = 0; $found = $false;
        while ($count -lt 30 -and -not $found) {
            [Win32]::EnumWindows($enumProc, [IntPtr]::Zero)
            if ($script:targetHWnd -ne [IntPtr]::Zero) {
                [Win32]::ShowWindow($script:targetHWnd, 9) # Restore
                [Win32]::SetForegroundWindow($script:targetHWnd)
                Sleep -Milliseconds 1500
                
                # Low-level Ctrl+V (Paste)
                [Win32]::keybd_event(0x11, 0, 0, 0) # Ctrl Down
                [Win32]::keybd_event(0x56, 0, 0, 0) # V Down
                Sleep -Milliseconds 100
                [Win32]::keybd_event(0x56, 0, 0x02, 0) # V Up
                [Win32]::keybd_event(0x11, 0, 0x02, 0) # Ctrl Up
                
                Sleep -Milliseconds 2000
                
                # Low-level Enter (Send)
                [Win32]::keybd_event(0x0D, 0, 0, 0) # Enter Down
                Sleep -Milliseconds 100
                [Win32]::keybd_event(0x0D, 0, 0x02, 0) # Enter Up
                
                $found = $true
            }
            if (-not $found) { Sleep -Milliseconds 1000; $count++ }
        }
      `;
      require('child_process').spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript]);
    }, 4000); // Increased wait time to 4s to ensure WhatsApp is fully loaded
  }
});

ipcMain.handle('groq-chat', async (event, { apiKey, messages }) => {
  console.log('[GroqChat] IPC received, key starts:', apiKey && apiKey.substring(0, 8));
  const https = require('https');
  const body = JSON.stringify({
    model: 'llama-3.1-8b-instant',
    max_tokens: 300,
    messages
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(json.error?.message || `HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve(json.choices?.[0]?.message?.content || '...');
          }
        } catch(e) { reject(new Error('Parse error: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
});

ipcMain.handle('openai-chat', async (_event, { apiKey, messages, model }) => {
  console.log('[OpenAIChat] IPC received, model:', model, 'key starts:', apiKey && apiKey.substring(0, 7));
  const https = require('https');
  const body = JSON.stringify({
    model: model || 'gpt-4.5-preview', // GPT-4.5 (latest as of 2025)
    max_tokens: 500,
    messages
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(json.error?.message || `HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve(json.choices?.[0]?.message?.content || '...');
          }
        } catch(e) { reject(new Error('Parse error: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
});

ipcMain.handle('claude-chat', async (_event, { apiKey, messages }) => {
  console.log('[ClaudeChat] IPC received, key starts:', apiKey && apiKey.substring(0, 10));
  const https = require('https');

  // Convert messages: extract system prompt, keep user/assistant turns
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: systemMsg ? systemMsg.content : undefined,
    messages: chatMessages
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(json.error?.message || `HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve(json.content?.[0]?.text || '...');
          }
        } catch(e) { reject(new Error('Parse error: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
});

ipcMain.handle('update-telegram-config', (event, data) => {
  const { updateConfig } = require('./telegram');
  return updateConfig(data);
});

ipcMain.handle('save-groq-key', (event, groqApiKey) => {
  const configPath = require('path').join(app.getPath('userData'), 'groq-config.json');
  fs.writeFileSync(configPath, JSON.stringify({ groqApiKey }));
});

// ── LOGICOM Public API — key management IPC ──────────────────────────────────
ipcMain.handle('api-keys-list', () => loadKeys());

ipcMain.handle('api-keys-create', (_e, label) => {
  const keys = loadKeys();
  const entry = { key: generateKey(), label: label || 'Clé sans nom', active: true, created: new Date().toISOString() };
  keys.push(entry);
  saveKeys(keys);
  return entry;
});

ipcMain.handle('api-keys-revoke', (_e, key) => {
  const keys = loadKeys().map(k => k.key === key ? { ...k, active: false } : k);
  saveKeys(keys);
  return true;
});

ipcMain.handle('api-keys-delete', (_e, key) => {
  saveKeys(loadKeys().filter(k => k.key !== key));
  return true;
});

ipcMain.handle('api-server-port', () => 3737);

// ── DAILY PROMISE ALERT ─────────────────────────────────────────────────────
function scheduleDuePromiseAlerts() {
  async function checkAndNotify() {
    const due = getDuePromises();
    if (!due.length) return;

    const { getBot } = require('./telegram');
    const bot = getBot();

    // Build summary for admin Telegram (read from config)
    let adminChatId = null;
    try {
      const cfgPath = require('path').join(app.getPath('userData'), 'telegram-config.json');
      const cfg = JSON.parse(require('fs').readFileSync(cfgPath, 'utf8'));
      adminChatId = cfg.adminChatId || null;
    } catch(e) {}

    const lines = due.map(c =>
      `• *${c.name}* (${c.phone}) — ${c.promisedAmount ? c.promisedAmount.toLocaleString('fr-DZ') + ' DA' : 'montant non précisé'} via *${c.promisedMethod || '?'}*${c.promiseNote ? `\n  _"${c.promiseNote}"_` : ''}`
    ).join('\n');

    const alertMsg =
      `🔔 *${due.length} promesse(s) de paiement arrivée(s) à échéance aujourd'hui !*\n\n${lines}\n\nRelancez-les maintenant.`;

    if (bot && adminChatId) {
      try { await bot.sendMessage(adminChatId, alertMsg, { parse_mode: 'Markdown' }); } catch(e) {}
    }
  }

  // Run once at startup (in case app was closed yesterday)
  setTimeout(checkAndNotify, 10000);

  // Then every 24 hours
  setInterval(checkAndNotify, 24 * 60 * 60 * 1000);
}

app.whenReady().then(async () => {
  console.log('App ready, initializing DB...');
  await initDB()
  console.log('DB Initialized!');
  registerIpcHandlers()
  startApiServer(getDB())
  initTelegram()
  initWhatsApp(null, async ({ channel, clientName, clientPhone, parsed, rawMessage }) => {
    // Notify admin on Telegram when WhatsApp auto-saves a promise
    const { getBot } = require('./telegram');
    const bot = getBot();
    const cfg = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'telegram-config.json'), 'utf8')); }
      catch(e) { return {}; }
    })();
    const adminChatId = cfg.adminChatId;
    if (!bot || !adminChatId) return;
    const alert =
      `🔔 *Promesse de paiement (${channel}) enregistrée auto !*\n\n` +
      `👤 Client : *${clientName}* (${clientPhone})\n` +
      `📅 Date : *${parsed.promisedDate || 'non précisée'}*\n` +
      `💰 Montant : *${parsed.promisedAmount ? parsed.promisedAmount.toLocaleString('fr-DZ') + ' DA' : 'non précisé'}*\n` +
      `💳 Mode : *${parsed.promisedMethod || 'non précisé'}*\n` +
      `💬 Ce qu'il a dit : _"${parsed.promiseNote || rawMessage}"_`;
    try { await bot.sendMessage(adminChatId, alert, { parse_mode: 'Markdown' }); } catch(e) {}
  })
  scheduleDuePromiseAlerts()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
