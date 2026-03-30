const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path')
const fs = require('fs')
const { initDB, registerIpcHandlers } = require('./db')
const { initTelegram } = require('./telegram')

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
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true } });
  
  const fullHtml = `
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: sans-serif; padding: 40px; color: #333; line-height: 1.5; }
          .preview-header { display: flex; justify-content: space-between; border-bottom: 2px solid #333; padding-bottom: 15px; margin-bottom: 20px; }
          .preview-logo { font-weight: 800; font-size: 24px; }
          .preview-logo span { color: #1a4fa0; }
          .preview-title { font-size: 20px; font-weight: 700; text-transform: uppercase; text-align: right; }
          .preview-info { display: flex; justify-content: space-between; margin-bottom: 25px; }
          .preview-info-box h4 { font-size: 11px; text-transform: uppercase; color: #777; margin-bottom: 5px; }
          .preview-table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
          .preview-table th { background: #f5f5f5; padding: 8px 12px; border-bottom: 2px solid #eee; text-align: left; font-size: 12px; }
          .preview-table td { padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 13px; }
          .preview-total-box { margin-left: auto; width: 280px; border-top: 2px solid #333; padding-top: 15px; }
          .preview-total-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; }
          .preview-grand-total { background: #333; color: white; padding: 12px 15px; font-size: 18px; font-weight: 700; margin-top: 8px; }
        </style>
      </head>
      <body>${html}</body>
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
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true } });
  const fullHtml = `<html><head><meta charset="UTF-8"><style>body { font-family: sans-serif; padding: 40px; }</style></head><body>${html}</body></html>`;
  await win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(fullHtml)}`);
  const data = await win.webContents.printToPDF({ printBackground: true, marginsType: 0, pageSize: 'A4' });
  const { filePath } = await dialog.showSaveDialog({ defaultPath: filename, filters: [{ name: 'PDF Files', extensions: ['pdf'] }] });
  if (filePath) { fs.writeFileSync(filePath, data); win.close(); return filePath; }
  win.close(); return null;
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
  initTelegram()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
