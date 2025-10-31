# Automated script to export PostgreSQL data and import into SQLite

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "PostgreSQL to SQLite Data Migration" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendDir = $PSScriptRoot
$dumpFile = Join-Path $projectRoot "olddata.dump"
$sqlFile = Join-Path $backendDir "olddata_hebrew.sql"
$sqliteDb = Join-Path $env:APPDATA "com.shabtzak.app\shabtzak.db"

# Step 1: Check Docker
Write-Host "[1/4] Checking Docker..." -ForegroundColor Yellow
$dockerAvailable = $false
try {
    $null = docker --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Docker found" -ForegroundColor Green
        $dockerAvailable = $true
    }
} catch {
    Write-Host "  Docker not found" -ForegroundColor Red
}

# Step 2: Try to export data
Write-Host "[2/4] Attempting to export data..." -ForegroundColor Yellow
$sqlFileCreated = $false

# Try Docker method
if ($dockerAvailable -and (Test-Path $dumpFile)) {
    try {
        $null = docker ps 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  Docker is running, starting PostgreSQL..." -ForegroundColor Cyan
            Push-Location $projectRoot
            docker-compose up -d db 2>&1 | Out-Null
            Start-Sleep -Seconds 8
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  PostgreSQL started, exporting data..." -ForegroundColor Cyan
                $env:PGPASSWORD = "devpass"
                python "$backendDir\export_from_postgres_python.py" --host localhost --user shabtzak --password devpass --database shabtzak --output $sqlFile
                
                if ((Test-Path $sqlFile) -and ((Get-Item $sqlFile).Length -gt 1000)) {
                    Write-Host "  Successfully exported!" -ForegroundColor Green
                    $sqlFileCreated = $true
                }
            }
            Pop-Location
        }
    } catch {
        # Continue to next method
    }
}

# Try direct connection
if (-not $sqlFileCreated) {
    Write-Host "  Trying direct PostgreSQL connection..." -ForegroundColor Cyan
    $env:PGPASSWORD = "devpass"
    python "$backendDir\export_from_postgres_python.py" --host localhost --user shabtzak --password devpass --database shabtzak --output $sqlFile 2>&1 | Out-Null
    
    if ((Test-Path $sqlFile) -and ((Get-Item $sqlFile).Length -gt 1000)) {
        Write-Host "  Successfully exported!" -ForegroundColor Green
        $sqlFileCreated = $true
    } else {
        Write-Host ""
        Write-Host "ERROR: Could not connect to PostgreSQL" -ForegroundColor Red
        Write-Host ""
        Write-Host "Please do one of the following:" -ForegroundColor Yellow
        Write-Host "  1. Start Docker Desktop" -ForegroundColor Yellow
        Write-Host "  2. Run: cd $projectRoot" -ForegroundColor Yellow
        Write-Host "  3. Run: docker-compose up -d db" -ForegroundColor Yellow
        Write-Host "  4. Wait 10 seconds, then run this script again" -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }
}

# Step 3: Check for Hebrew
Write-Host "[3/4] Checking for Hebrew content..." -ForegroundColor Yellow
if (Test-Path $sqlFile) {
    $content = Get-Content $sqlFile -Raw -Encoding UTF8
    if ($content -match '[\u0590-\u05FF]') {
        $count = ([regex]::Matches($content, '[\u0590-\u05FF]')).Count
        Write-Host "  Found $count Hebrew characters!" -ForegroundColor Green
    } else {
        Write-Host "  No Hebrew characters found" -ForegroundColor Yellow
    }
}

# Step 4: Import to SQLite
Write-Host "[4/4] Importing into SQLite..." -ForegroundColor Yellow
if (Test-Path $sqlFile) {
    $dbDir = Split-Path $sqliteDb -Parent
    if (-not (Test-Path $dbDir)) {
        New-Item -ItemType Directory -Path $dbDir -Force | Out-Null
    }
    
    python "$backendDir\import_olddata.py" $sqlFile --db $sqliteDb
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "Migration Complete!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "SQLite database: $sqliteDb" -ForegroundColor Cyan
        Write-Host "Restart your desktop app to see the data." -ForegroundColor Cyan
    } else {
        Write-Host "  Import failed" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  SQL file not found" -ForegroundColor Red
    exit 1
}
