# Shabtzak App Setup Script
# This script helps set up the Tauri desktop app

Write-Host "=== Shabtzak App Setup ===" -ForegroundColor Cyan

# Check for Rust
Write-Host ""
Write-Host "Checking for Rust..." -ForegroundColor Yellow
$rustc = Get-Command rustc -ErrorAction SilentlyContinue
$cargo = Get-Command cargo -ErrorAction SilentlyContinue

if (-not $rustc -or -not $cargo) {
    Write-Host "Rust is not installed!" -ForegroundColor Red
    Write-Host "Please install Rust from: https://rustup.rs/" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "After installing Rust, restart your terminal and run this script again." -ForegroundColor Yellow
    exit 1
} else {
    $rustVersion = rustc --version
    Write-Host "Rust is installed: $rustVersion" -ForegroundColor Green
}

# Check for npm packages
Write-Host ""
Write-Host "Checking npm packages..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    Write-Host "npm packages installed" -ForegroundColor Green
} else {
    Write-Host "Installing npm packages..." -ForegroundColor Yellow
    npm install
}

# Check for icons
Write-Host ""
Write-Host "Checking for app icons..." -ForegroundColor Yellow
$iconsDir = "src-tauri\icons"
$requiredIcons = @(
    "32x32.png",
    "128x128.png", 
    "128x128@2x.png",
    "icon.ico",
    "icon.icns"
)

$missingIcons = @()
foreach ($icon in $requiredIcons) {
    $iconPath = Join-Path $iconsDir $icon
    if (-not (Test-Path $iconPath)) {
        $missingIcons += $icon
    }
}

if ($missingIcons.Count -gt 0) {
    Write-Host "Icons are missing: $($missingIcons -join ', ')" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To generate icons:" -ForegroundColor Cyan
    Write-Host "1. Create a 512x512px PNG image as your app icon" -ForegroundColor White
    Write-Host "2. Install Tauri CLI: npm install -g @tauri-apps/cli" -ForegroundColor White
    Write-Host "3. Generate icons: tauri icon path/to/your-icon.png" -ForegroundColor White
    Write-Host ""
    Write-Host "Or you can create them manually and place them in: $iconsDir" -ForegroundColor White
} else {
    Write-Host "All icons present" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "To run the app in development:" -ForegroundColor Yellow
Write-Host "  npm run tauri:dev" -ForegroundColor White
Write-Host ""
Write-Host "To build for production:" -ForegroundColor Yellow
Write-Host "  npm run tauri:build" -ForegroundColor White
Write-Host ""
Write-Host "Note: Make sure your backend is running on localhost:8000" -ForegroundColor Cyan
