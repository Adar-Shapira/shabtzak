# Distribution Guide

## ✅ App is Now Self-Contained with Data!

Your app is now configured to bundle **all data** with the installer. When someone downloads and installs the app, they will get:

### What's Included:
1. **Frontend** (React + TypeScript) - bundled into the executable
2. **Backend** (FastAPI + Python) - bundled as a sidecar executable
3. **Initial Database** - with all your Hebrew soldier names and data
4. **No external dependencies** - No Docker, PostgreSQL, or manual setup needed

### How It Works:

1. **During Build:**
   - The database file (`shabtzak.db`) is bundled into the installer
   - Located at: `shabtzak-ui/src-tauri/resources/shabtzak.db`

2. **On First Launch:**
   - App checks if user's database exists (at `%APPDATA%/com.shabtzak.app/shabtzak.db`)
   - If not found, copies the bundled database to the user's app data directory
   - User can then modify data locally without affecting others

3. **Data Persistence:**
   - Each user's data is stored locally in their app data directory
   - Changes are independent per user
   - Initial data (Hebrew soldiers, missions, etc.) is available to everyone

### To Distribute:

1. **Ensure database is in resources folder:**
   ```powershell
   # Copy your current database
   Copy-Item "$env:APPDATA\com.shabtzak.app\shabtzak.db" `
     -Destination "shabtzak-ui\src-tauri\resources\shabtzak.db" -Force
   ```

2. **Build the installer:**
   ```powershell
   cd shabtzak-ui
   npm run tauri build
   ```

3. **Distribute the installer:**
   - Windows: `shabtzak-ui/src-tauri/target/release/bundle/nsis/Shabtzak_0.1.0_x64-setup.exe`
   - MSI: `shabtzak-ui/src-tauri/target/release/bundle/msi/Shabtzak_0.1.0_x64_en-US.msi`

### What Users Get:

When a user installs and runs the app for the first time:
- ✅ App launches automatically
- ✅ Backend starts on a free port (8000 or next available)
- ✅ Database is initialized with all your Hebrew data
- ✅ No configuration needed
- ✅ Everything works immediately

### File Structure:

```
Shabtzak_Installer.exe
├── Frontend (bundled)
├── Backend (api-server.exe)
└── Resources
    └── shabtzak.db (initial data with Hebrew names)
```

After installation:
```
%APPDATA%/com.shabtzak.app/
├── shabtzak.db (copied from bundle, can be modified)
└── backend.log (debugging logs)
```

### Updating Initial Data:

If you need to update the initial data:
1. Update your local database (`%APPDATA%/com.shabtzak.app/shabtzak.db`)
2. Copy it to resources: `Copy-Item "$env:APPDATA\com.shabtzak.app\shabtzak.db" -Destination "shabtzak-ui\src-tauri\resources\shabtzak.db" -Force`
3. Rebuild: `cd shabtzak-ui && npm run tauri build`

### Notes:

- Each user gets their own copy of the database (can modify independently)
- The bundled database is a **template** - only copied on first launch
- Users can backup their database from `%APPDATA%/com.shabtzak.app/shabtzak.db`
- All data (Hebrew names, missions, assignments, etc.) is preserved

---

**The app is now fully portable and ready for distribution!** 🎉

