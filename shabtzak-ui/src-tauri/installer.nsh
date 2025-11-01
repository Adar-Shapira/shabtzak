; Custom NSIS installer script for Shabtzak
; This ensures only the main app shortcut appears on desktop
; This file should be included in the installer.nsi after it's generated

; Hook into installation success to clean up unwanted shortcuts
Function .onInstSuccess
  ; Delete any unwanted shortcuts that might have been created
  Delete "$DESKTOP\api-server.lnk"
  Delete "$DESKTOP\Uninstall Shabtzak.lnk"
  Delete "$DESKTOP\resources.lnk"
  Delete "$DESKTOP\api-server.exe.lnk"
FunctionEnd

; Clean up shortcuts on uninstall
Function un.onUninstSuccess
  Delete "$DESKTOP\Shabtzak.lnk"
  Delete "$DESKTOP\api-server.lnk"
  Delete "$DESKTOP\Uninstall Shabtzak.lnk"
  Delete "$DESKTOP\resources.lnk"
  Delete "$DESKTOP\api-server.exe.lnk"
FunctionEnd

