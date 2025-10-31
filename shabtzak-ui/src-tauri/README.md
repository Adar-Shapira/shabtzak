# Tauri Setup

This directory contains the Tauri backend configuration for the Shabtzak desktop app.

## Icons Required

Before building, you need to create icons in the `icons/` directory:

- `32x32.png` - Small icon
- `128x128.png` - Medium icon  
- `128x128@2x.png` - Medium icon (retina)
- `icon.icns` - macOS icon bundle
- `icon.ico` - Windows icon file

### Quick Icon Setup

1. Create a square image (at least 512x512px) as your app icon
2. Use the Tauri icon generator: https://github.com/tauri-apps/tauri-icon
   ```bash
   npm install -g @tauri-apps/cli
   tauri icon path/to/your/icon.png
   ```
   This will generate all required icon formats in the correct directory.

Or manually create:
- PNG files: Export from your design tool
- `.icns`: Use `iconutil` on macOS or online converters
- `.ico`: Use online converters or tools like IcoFX

## Building

```bash
# Install Rust if you haven't (from https://rustup.rs/)
# Then in shabtzak-ui/:
npm install
npm run tauri:build
```

The built app will be in `src-tauri/target/release/bundle/`

