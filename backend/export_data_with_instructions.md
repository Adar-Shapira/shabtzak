# Export PostgreSQL Data with Hebrew Names

## Current Situation
- PostgreSQL database is not currently running (connection failed)
- The `olddata.dump` file is a PostgreSQL binary dump that requires `pg_restore`
- Existing SQL files don't contain Hebrew characters

## Options to Export Data:

### Option 1: Start PostgreSQL via Docker Compose
If you have Docker Desktop installed:

1. **Start Docker Desktop**
2. **Navigate to project root and start services:**
   ```powershell
   cd C:\Users\Adar\Documents\shabtzak
   docker-compose up -d db
   ```

3. **Wait for database to start, then export:**
   ```powershell
   cd backend
   $env:PGPASSWORD="devpass"
   python export_from_postgres_python.py --host localhost --user shabtzak --password devpass --database shabtzak
   ```

### Option 2: Use Docker to Restore Binary Dump
If you have Docker Desktop:

1. **Start Docker Desktop**
2. **Convert binary dump to SQL:**
   ```powershell
   cd C:\Users\Adar\Documents\shabtzak
   docker run --rm -v "${PWD}:/data" -w /data postgres:16-alpine sh -c "pg_restore --no-owner --no-privileges /data/olddata.dump > olddata_hebrew.sql"
   ```

### Option 3: Install PostgreSQL Client Tools
Download and install PostgreSQL from: https://www.postgresql.org/download/windows/

Then use:
```powershell
cd C:\Users\Adar\Documents\shabtzak\backend
$env:PGPASSWORD="devpass"
python export_from_postgres.py --host localhost --user shabtzak --database shabtzak
```

### Option 4: Access Remote/External PostgreSQL
If your PostgreSQL database with Hebrew data is on a different server:

```powershell
cd backend
$env:PGPASSWORD="your_password"
python export_from_postgres_python.py --host your_host --user your_user --database your_db
```

## After Export
Once you have `olddata_hebrew.sql`, import it into SQLite:
```powershell
python import_olddata.py olddata_hebrew.sql --db "$env:APPDATA\com.shabtzak.app\shabtzak.db"
```

