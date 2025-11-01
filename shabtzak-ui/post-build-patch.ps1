# Post-build patch script - patches installer.nsi AFTER Tauri generates it
# This must run AFTER "tauri build" generates the installer.nsi but BEFORE makensis runs
# Actually, tauri build runs makensis automatically, so we need to patch before rebuild

param(
    [string]$NsiPath = "src-tauri\target\release\nsis\x64\installer.nsi"
)

Write-Host "Checking installer.nsi for patching..." -ForegroundColor Cyan

if (-not (Test-Path $NsiPath)) {
    Write-Host "Installer.nsi not found - it will be generated during build" -ForegroundColor Yellow
    exit 0
}

$content = [System.IO.File]::ReadAllText($NsiPath, [System.Text.Encoding]::UTF8)

# Check if already patched
if ($content -match "Custom cleanup.*Remove unwanted shortcuts") {
    Write-Host "✅ Installer already patched" -ForegroundColor Green
    exit 0
}

# Add cleanup code to .onInstSuccess function
$cleanup = @"
  ; Custom cleanup: Remove unwanted shortcuts (only keep Shabtzak app)
  Delete `$DESKTOP\api-server.lnk
  Delete `$DESKTOP\Uninstall Shabtzak.lnk
  Delete `$DESKTOP\resources.lnk
  Delete `$DESKTOP\api-server.exe.lnk
"@

# Find .onInstSuccess and add cleanup before FunctionEnd
if ($content -match 'run_done:\s*FunctionEnd') {
    $newContent = $content -replace '(run_done:\s*)(FunctionEnd)', "`$1$cleanup`nFunctionEnd"
    [System.IO.File]::WriteAllText($NsiPath, $newContent, [System.Text.Encoding]::UTF8)
    Write-Host "✅ Patched installer.nsi - will remove unwanted shortcuts" -ForegroundColor Green
} else {
    Write-Host "⚠️ Could not find insertion point in installer.nsi" -ForegroundColor Yellow
}

