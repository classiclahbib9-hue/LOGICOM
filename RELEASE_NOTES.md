# Release Notes – Logicom v1.0.0

## Highlights
- Custom installer branding (icons, banner, NSIS UI tweaks).
- Data persistence fixed – SQLite database stored in `%APPDATA%\logicom-desktop`.
- Database path can be changed from the UI.
- Installer now lets the user choose the installation folder.

## Installation
1. Run `Logicom Setup 1.0.0.exe`.
2. Choose the destination folder.
3. After installation launch Logicom; data will be saved automatically.

## Known Issues
- None at the moment.

## Building from source
```powershell
npm install
npm run dist   # builds the installer
```
