# Converting Shabtzak to a Standalone App

This guide covers multiple options for packaging your web app as a standalone application.

## Option 1: Tauri (Desktop App - Recommended)

**Tauri** is a modern, lightweight framework for building desktop apps. It uses your existing web frontend and wraps it in a native app with a minimal footprint.

### Prerequisites
1. **Rust** - Install from https://rustup.rs/
2. **System dependencies** (for Windows you're likely already set)

### Setup Steps

1. **Install dependencies**:
   ```bash
   cd shabtzak-ui
   npm install
   ```

2. **Create app icons**:
   You need to create icon files in `shabtzak-ui/src-tauri/icons/`:
   - `32x32.png`
   - `128x128.png`
   - `128x128@2x.png`
   - `icon.icns` (macOS)
   - `icon.ico` (Windows)
   
   For now, you can use placeholder icons or generate them using:
   - https://tauri.app/v1/guides/building/icon
   - Or use an online icon generator

3. **Run the app**:
   ```bash
   npm run tauri:dev
   ```

4. **Build for production**:
   ```bash
   npm run tauri:build
   ```
   This creates installers in `src-tauri/target/release/bundle/`

### Backend Setup

Since the app connects to `http://localhost:8000`, you'll need to:
- **Option A**: Run the backend separately before starting the app
- **Option B**: Bundle the backend (future enhancement - you could use Tauri's shell commands to start a bundled Python runtime)

---

## Option 2: Progressive Web App (PWA)

A PWA allows users to "install" your web app on their device. Works on desktop, mobile, and tablets.

### Setup Steps

1. **Already configured!** - Check `shabtzak-ui/` for `manifest.json` and service worker files

2. **To enable PWA features**, update your build to include:
   ```bash
   npm install -D vite-plugin-pwa
   ```

3. **Service Worker**: The app will work offline after first load

4. **Installation**: Users can "Add to Home Screen" on mobile or "Install" in desktop browsers

---

## Option 3: Electron (Alternative Desktop App)

**Electron** is more traditional and has more resources, but creates larger app bundles.

### Setup Steps

1. **Install Electron**:
   ```bash
   cd shabtzak-ui
   npm install --save-dev electron electron-builder
   ```

2. **Create `electron-main.js`** in `shabtzak-ui/`:
   ```javascript
   const { app, BrowserWindow } = require('electron');
   const path = require('path');
   
   function createWindow() {
     const win = new BrowserWindow({
       width: 1200,
       height: 800,
       webPreferences: {
         nodeIntegration: false,
         contextIsolation: true,
       },
     });
     
     if (process.env.ELECTRON_IS_DEV) {
       win.loadURL('http://localhost:5173');
     } else {
       win.loadFile(path.join(__dirname, 'dist/index.html'));
     }
   }
   
   app.whenReady().then(createWindow);
   
   app.on('window-all-closed', () => {
     if (process.platform !== 'darwin') app.quit();
   });
   ```

3. **Add to package.json**:
   ```json
   "main": "electron-main.js",
   "scripts": {
     "electron:dev": "ELECTRON_IS_DEV=1 electron .",
     "electron:build": "npm run build && electron-builder"
   }
   ```

---

## Option 4: Mobile App (React Native / Capacitor)

For iOS/Android mobile apps:

### Using Capacitor (Easiest)

1. **Install Capacitor**:
   ```bash
   npm install @capacitor/core @capacitor/cli
   npx cap init
   ```

2. **Add platforms**:
   ```bash
   npm install @capacitor/ios @capacitor/android
   npx cap add ios
   npx cap add android
   ```

3. **Build and sync**:
   ```bash
   npm run build
   npx cap sync
   ```

4. **Open in IDE**:
   ```bash
   npx cap open ios      # Opens Xcode
   npx cap open android  # Opens Android Studio
   ```

---

## Recommendations

- **For Desktop**: Use **Tauri** (lightweight, secure, modern)
- **For Quick Deployment**: Use **PWA** (works everywhere, no install needed)
- **For Mobile**: Use **Capacitor** (reuses most of your React code)

## Notes

- The backend API URL is configured in `src/api.ts` via `VITE_API_URL`
- For production, you may want to bundle the backend or use a hosted API
- All options maintain your existing React codebase - no major refactoring needed

