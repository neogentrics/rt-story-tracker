; Says the app is installed, so other Recon Towers apps can find it before it has ever been run, and takes that back when
; it's uninstalled. The file holds no secrets: the app's id, name, version and where it starts. The app writes the same file
; itself when it runs. See docs/design/the-suite.md.

; The path with / for \, because a backslash in JSON has to be doubled and Windows reads a forward slash just as well.
; Only the installer uses it, and the uninstaller is built from the same script.
!ifndef BUILD_UNINSTALLER
Function RtSlashes
  StrCpy $1 ""
  StrCpy $2 0
  rtloop:
    StrCpy $3 $0 1 $2
    StrCmp $3 "" rtdone
    StrCmp $3 "\" 0 +2
      StrCpy $3 "/"
    StrCpy $1 "$1$3"
    IntOp $2 $2 + 1
    Goto rtloop
  rtdone:
  Push $1
FunctionEnd
!endif

!macro customInstall
  CreateDirectory "$APPDATA\Recon Towers\app-link\installed"
  StrCpy $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  Call RtSlashes
  Pop $1
  FileOpen $4 "$APPDATA\Recon Towers\app-link\installed\rt-story-tracker.json" w
  FileWrite $4 '{$\r$\n  "id": "rt-story-tracker",$\r$\n  "name": "RT Story Tracker",$\r$\n  "version": "${VERSION}",$\r$\n  "launch": "$1",$\r$\n  "protocol": 1$\r$\n}$\r$\n'
  FileClose $4
!macroend

!macro customUnInstall
  Delete "$APPDATA\Recon Towers\app-link\installed\rt-story-tracker.json"
!macroend
