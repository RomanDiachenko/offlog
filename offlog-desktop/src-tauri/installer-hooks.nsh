; Offlog's installer wording, in place of NSIS's stock text.
;
; Tauri includes this file above every page macro, so these MUI defines are
; picked up by the matching page. Keep the text ASCII: NSIS reads an include
; without a BOM as the system codepage, which mangles anything else.
; Tauri's own strings (the desktop-shortcut checkbox, the uninstaller's
; delete-data checkbox, the app-is-open prompts) live in
; installer-english.nsh instead.

!define MUI_WELCOMEPAGE_TITLE "Install Offlog"
!define MUI_WELCOMEPAGE_TEXT "A calm task manager that keeps your tasks on this PC. No account, no cloud.$\r$\n$\r$\nOfflog installs just for you, with no administrator rights needed.$\r$\n$\r$\nClick Next to continue."

!define MUI_DIRECTORYPAGE_TEXT_TOP "Offlog will be installed in this folder. You can keep it as it is."

!define MUI_FINISHPAGE_TITLE "Offlog is installed"
!define MUI_FINISHPAGE_TEXT "Offlog lives in the system tray. Press Ctrl+Alt+O to open it from anywhere.$\r$\n$\r$\nTo sync your phone, open Settings > Sync."
!define MUI_FINISHPAGE_RUN_TEXT "Open Offlog now"

!define MUI_UNCONFIRMPAGE_TEXT_TOP "Offlog will be removed from this PC. Your tasks stay on this PC unless you tick the box below."

; The headings and status lines come from MUI's language file, which sets a
; string only when it isn't defined yet, so defining it here first wins.
; The buttons (Next, Back, Install, Browse) and the disk-space labels stay
; stock: they are the standard Windows installer vocabulary.
!define MUI_TEXT_DIRECTORY_TITLE "Choose a folder"
!define MUI_TEXT_DIRECTORY_SUBTITLE "Where Offlog will be installed."
!define MUI_TEXT_INSTALLING_TITLE "Installing"
!define MUI_TEXT_INSTALLING_SUBTITLE "Installing Offlog. This takes a few seconds."
!define MUI_TEXT_FINISH_TITLE "Done"
!define MUI_TEXT_FINISH_SUBTITLE "Offlog is installed."
!define MUI_TEXT_ABORT_TITLE "Not installed"
!define MUI_TEXT_ABORT_SUBTITLE "Setup stopped before Offlog was installed."

!define MUI_UNTEXT_CONFIRM_TITLE "Uninstall Offlog"
!define MUI_UNTEXT_CONFIRM_SUBTITLE "Remove Offlog from this PC."
!define MUI_UNTEXT_UNINSTALLING_TITLE "Uninstalling"
!define MUI_UNTEXT_UNINSTALLING_SUBTITLE "Removing Offlog. This takes a few seconds."
!define MUI_UNTEXT_FINISH_TITLE "Done"
!define MUI_UNTEXT_FINISH_SUBTITLE "Offlog is removed from this PC."
!define MUI_UNTEXT_ABORT_TITLE "Not uninstalled"
!define MUI_UNTEXT_ABORT_SUBTITLE "Offlog is still installed."
