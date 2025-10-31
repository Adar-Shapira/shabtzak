# Step-by-Step Instructions

## Step 1: Start Docker Desktop
1. Open Docker Desktop application (search for "Docker Desktop" in Windows Start menu)
2. Wait for it to fully start (you'll see "Docker Desktop is running" in the system tray)

## Step 2: Once Docker Desktop is running, open PowerShell and run:

```powershell
cd C:\Users\Adar\Documents\shabtzak
docker-compose up -d db
```

Wait about 10 seconds for the database to start.

## Step 3: Export and Import Data

```powershell
cd C:\Users\Adar\Documents\shabtzak\backend
.\export_and_import.ps1
```

This will:
- Export all data from PostgreSQL (including Hebrew names)
- Import it into your SQLite database
- Show you if Hebrew characters were found

## Step 4: Restart your desktop app
After the import completes, restart your Shabtzak desktop app to see all the imported data with Hebrew names.

