const { app, BrowserWindow, Menu } = require('electron');
const path = require('path')
const { initDB, registerIpcHandlers } = require('./db')

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'icon.png') // you can add an icon here
  })

  // Create a minimal menu to enable reload and dev tools
  const template = [
    {
      label: 'Édition',
      submenu: [
        { label: 'Annuler', role: 'undo' },
        { label: 'Rétablir', role: 'redo' },
        { type: 'separator' },
        { label: 'Couper', role: 'cut' },
        { label: 'Copier', role: 'copy' },
        { label: 'Coller', role: 'paste' },
        { label: 'Tout sélectionner', role: 'selectAll' }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Actualiser', accelerator: 'CmdOrCtrl+R', click: () => { mainWindow.webContents.reload() } },
        { label: 'Actualiser (Forcé)', accelerator: 'CmdOrCtrl+Shift+R', click: () => { mainWindow.webContents.reloadIgnoringCache() } },
        { type: 'separator' },
        { label: 'Plein écran', role: 'togglefullscreen' },
        { label: 'Outils de développement', accelerator: 'F12', click: () => { mainWindow.webContents.toggleDevTools() } }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Load the index.html of the app
  mainWindow.loadFile('index.html')
}

// Ensure database setup
app.whenReady().then(() => {
  initDB()
  registerIpcHandlers()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})
