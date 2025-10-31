# Quick Start Guide

## Current Status

✅ **npm packages installed** - All dependencies are ready  
✅ **Tauri configuration** - Desktop app is configured  
✅ **PWA manifest** - Web app can be installed  
⚠️ **Rust not installed** - Required for Tauri desktop app  
⚠️ **Icons missing** - Required before building desktop app

## Option 1: Test as PWA (No Rust Needed)

You can immediately test the app as a Progressive Web App:

```bash
npm run dev
```

Then open `http://localhost:5173` in your browser. You'll be able to:
- Use the "Install" option in Chrome/Edge (three dots menu → "Install Shabtzak")
- Add to Home Screen on mobile devices

## Option 2: Set Up Desktop App (Requires Rust)

### Step 1: Install Rust

**Windows:**
1. Download and run: https://rustup.rs/
2. Or run in PowerShell:
   ```powershell
   Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile "rustup-init.exe"
   .\rustup-init.exe
   ```
3. Restart your terminal after installation

### Step 2: Generate Icons

Once Rust is installed:

```bash
# Install Tauri CLI globally (optional, or use npx)
npm install -g @tauri-apps/cli

# Create a 512x512px PNG image of your app icon
# Then generate all icon formats:
tauri icon path/to/your-icon-512x512.png
```

Or use npx:
```bash
npx @tauri-apps/cli icon path/to/your-icon-512x512.png
```

This will automatically create all required icon files in `src-tauri/icons/`

### Step 3: Run Desktop App

```bash
# Make sure backend is running on port 8000
npm run tauri:dev
```

### Step 4: Build for Production

```bash
npm run tauri:build
```

The built installers will be in `src-tauri/target/release/bundle/`

## Setup Script

Run the automated setup check:

```powershell
.\setup-app.ps1
```

This will check:
- Rust installation
- npm packages
- Missing icons
- Provide next steps

## Troubleshooting

**Backend Connection:**
- The app connects to `http://localhost:8000` by default
- Make sure your FastAPI backend is running before starting the app
- You can change the API URL via `VITE_API_URL` environment variable

**Icons Error:**
- Icons are required for Tauri builds
- Use the `tauri icon` command to generate them from a 512x512px PNG

**Rust Errors:**
- Make sure Rust is installed: `rustc --version`
- Restart terminal after Rust installation
- On Windows, you may need Visual Studio Build Tools

