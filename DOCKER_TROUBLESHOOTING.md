# Docker Desktop Troubleshooting

## Issue: Docker Desktop processes are running but Docker daemon isn't responding

### Solution 1: Restart Docker Desktop
1. Right-click on Docker Desktop icon in system tray
2. Click "Quit Docker Desktop"
3. Wait 10 seconds
4. Start Docker Desktop again from Start menu
5. Wait for it to fully start (green icon in system tray)
6. Try again: `docker-compose up -d db`

### Solution 2: Check Docker Desktop Status
1. Open Docker Desktop application
2. Check if it shows any error messages
3. Make sure it says "Docker Desktop is running"
4. Wait a few minutes if it's still starting up

### Solution 3: Alternative - Use Existing PostgreSQL (if available)
If you have PostgreSQL running elsewhere (not in Docker), you can export directly:
```powershell
cd C:\Users\Adar\Documents\shabtzak\backend
$env:PGPASSWORD="devpass"
python export_from_postgres_python.py --host YOUR_HOST --user shabtzak --password devpass --database shabtzak
```

### Solution 4: Install PostgreSQL Client Tools
If Docker continues to have issues, install PostgreSQL client tools:
1. Download from: https://www.postgresql.org/download/windows/
2. Install PostgreSQL (or just the client tools)
3. Then you can restore the binary dump:
```powershell
cd C:\Users\Adar\Documents\shabtzak
pg_restore --no-owner --no-privileges olddata.dump > olddata_hebrew.sql
```

