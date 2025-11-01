# Post-build script to patch NSIS installer to remove unwanted desktop shortcuts
param(
    [string]$TargetDir = "src-tauri\target\release\nsis\x64"
)

$installerNsi = Join-Path $TargetDir "installer.nsi"

if (-not (Test-Path $installerNsi)) {
    Write-Host "Installer.nsi not found at: $installerNsi" -ForegroundColor Yellow
    exit 0
}

Write-Host "Patching installer.nsi to remove unwanted shortcuts..." -ForegroundColor Cyan

$content = Get-Content $installerNsi -Raw -Encoding UTF8

# Check if already patched
if ($content -match "Custom cleanup.*Remove unwanted shortcuts") {
    Write-Host "Installer already patched." -ForegroundColor Green
    exit 0
}

# Find the CreateDesktopShortcut function and add cleanup code before it
$cleanupCode = @"
; Custom cleanup: Remove unwanted shortcuts
Function .onInstSuccess
  Delete `$DESKTOP\api-server.lnk
  Delete `$DESKTOP\Uninstall Shabtzak.lnk
  Delete `$DESKTOP\resources.lnk
  Delete `$DESKTOP\api-server.exe.lnk
FunctionEnd

Function un.onUninstSuccess
  Delete `$DESKTOP\api-server.lnk
  Delete `$DESKTOP\Uninstall Shabtzak.lnk
  Delete `$DESKTOP\resources.lnk
  Delete `$DESKTOP\api-server.exe.lnk
FunctionEnd

"@

# Find .onInstSuccess function and add cleanup to it
if ($content -match 'Function \.onInstSuccess') {
    # Add cleanup code at the end of .onInstSuccess function (before FunctionEnd)
    $cleanupCodeInFunction = @"
  ; Custom cleanup: Remove unwanted shortcuts
  Delete `$DESKTOP\api-server.lnk
  Delete `$DESKTOP\Uninstall Shabtzak.lnk
  Delete `$DESKTOP\resources.lnk
  Delete `$DESKTOP\api-server.exe.lnk

"@
    
    # Insert cleanup before the FunctionEnd of .onInstSuccess
    $pattern = '(Function \.onInstSuccess[\s\S]*?)(FunctionEnd)'
    if ($content -match $pattern) {
        $newContent = $content -replace $pattern, "`${1}$cleanupCodeInFunction`${2}"
        [System.IO.File]::WriteAllText($installerNsi, $newContent, [System.Text.Encoding]::UTF8)
        Write-Host "✓ Patched installer.nsi" -ForegroundColor Green
        Write-Host "  The installer will now remove unwanted shortcuts after installation." -ForegroundColor White
    } else {
        Write-Host "Warning: Could not inject cleanup into .onInstSuccess" -ForegroundColor Yellow
    }
} elseif ($content -match "Function CreateDesktopShortcut") {
    # Fallback: Add as separate function before CreateDesktopShortcut
    $newContent = $content -replace "Function CreateDesktopShortcut", "$cleanupCode`nFunction CreateDesktopShortcut"
    [System.IO.File]::WriteAllText($installerNsi, $newContent, [System.Text.Encoding]::UTF8)
    Write-Host "✓ Patched installer.nsi" -ForegroundColor Green
    Write-Host "  The installer will now remove unwanted shortcuts after installation." -ForegroundColor White
} else {
    Write-Host "Warning: Could not find .onInstSuccess or CreateDesktopShortcut function" -ForegroundColor Yellow
}

