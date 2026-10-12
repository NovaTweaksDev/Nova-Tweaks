!macro customUnInstall
  ${IfNot} ${isUpdated}
    ; Electron's CurrentUser login item uses the application name. Remove only
    ; this application's Run entry; retain settings, reports and backups.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Nova Tweaks"
  ${EndIf}
!macroend
