Param(
    [string]$OutDir = "..\shabtzak-ui\src-tauri\bin"
)

Write-Host "== Build backend sidecar ==" -ForegroundColor Cyan

if (-not (Get-Command pyinstaller -ErrorAction SilentlyContinue)) {
    Write-Host "Installing PyInstaller..." -ForegroundColor Yellow
    python -m pip install --upgrade pip
    python -m pip install pyinstaller
}

Write-Host "Installing backend deps..." -ForegroundColor Yellow
python -m pip install -r requirements.txt

$specOut = Join-Path (Get-Location) "dist"
if (Test-Path $specOut) { Remove-Item $specOut -Recurse -Force }

pyinstaller --noconfirm --onefile --name api-server start.py

$exe = Join-Path (Get-Location) "dist\api-server.exe"
if (-not (Test-Path $exe)) {
    throw "Build failed; api-server.exe not found"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item $exe (Join-Path $OutDir "api-server.exe") -Force
Write-Host "Sidecar copied to $OutDir\api-server.exe" -ForegroundColor Green


