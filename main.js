const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path')
const fs = require('fs')
const { initDB, registerIpcHandlers, forceSave, addClientManually, getClientByPhone, getOptionsAndActivities } = require('./db')
const { initTelegram } = require('./telegram')
const { initWhatsApp, destroyWhatsApp, getStatus: getWhatsAppStatus } = require('./whatsapp')
const conversationManager = require('./agent/conversation-manager')
const agentConfig = require('./agent/config')

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

ipcMain.handle('open-whatsapp', async (event, url) => {
  return shell.openExternal(url);
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

ipcMain.handle('update-telegram-config', (event, data) => {
  const { updateConfig } = require('./telegram');
  return updateConfig(data);
});

app.whenReady().then(async () => {
  console.log('App ready, initializing DB...');
  await initDB()
  console.log('DB Initialized!');
  registerIpcHandlers()

  // Initialize the AI conversation manager
  conversationManager.init({
    addClientManually,
    getClientByPhone,
    getOptionsAndActivities
  });

  initTelegram()

  // Initialize WhatsApp if enabled
  try { initWhatsApp(); } catch(e) { console.error('WhatsApp init error:', e); }

  // ── Agent config IPC handlers ──
  ipcMain.handle('get-agent-config', () => agentConfig.loadConfig());
  ipcMain.handle('save-agent-config', (event, config) => {
    const updated = agentConfig.updateConfig(config);
    // Reinit Claude client if API key changed
    if (config.claudeApiKey) conversationManager.reinit(config.claudeApiKey);
    return updated;
  });

  // ── WhatsApp IPC handlers ──
  ipcMain.handle('whatsapp-status', () => getWhatsAppStatus());
  ipcMain.handle('whatsapp-connect', () => { initWhatsApp(); return true; });
  ipcMain.handle('whatsapp-disconnect', () => { destroyWhatsApp(); return true; });

  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// ── Guaranteed save before the process exits ──
app.on('before-quit', () => { try { forceSave(); } catch(e) { console.error('before-quit save failed:', e); } })
