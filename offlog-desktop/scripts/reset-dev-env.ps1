# Wipes every piece of local dev/test state this project accumulates, so
# testing always starts from a genuine zero-data, zero-config state --
# the same state a brand-new user's install would be in. Run this after
# any test round, not just when things look broken; dev NyxDB/Tauri
# state otherwise silently piles up release over release (E2's
# dev/prod identity-collision bug was found *because* of exactly this
# kind of accumulated mess -- see docs/archive/history.md's E2 entry).
#
# Scope: this script only ever touches DEV/TEST state -- this machine's
# Tauri debug config/data and debug-build logs. It never touches a real,
# in-use install's data (release-build `sync-host.json`/NyxDB data, or
# `vendor/nyxdb-win/` itself, which is just the pristine binary
# `fetch-nyxdb-win.ps1` built -- NyxDB needs no per-build copy the way
# CouchDB's config-file rewrite once did, it's resolved and run directly
# from `vendor/nyxdb-win/` or the bundled resource dir).
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/reset-dev-env.ps1
#   -IncludeRelease   also wipe the release-build local config/NyxDB
#                     data (only do this if you're testing a real install
#                     from scratch and are OK losing it)

param(
    [switch]$IncludeRelease
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot   # offlog-desktop/

Write-Host "== Offlog dev-env reset ==" -ForegroundColor Cyan

# Every removal goes through here, so one that fails (a file a running dev
# build holds open) is collected and reported at the end rather than
# stopping the script halfway or being passed over with "Done."
$failed = New-Object System.Collections.Generic.List[string]
function Remove-Path([string]$Path, [string]$What) {
    if (-not (Test-Path $Path)) { return }
    try {
        Remove-Item -Recurse -Force $Path -ErrorAction Stop
        Write-Host "Removed $What`: $Path"
    } catch {
        Write-Host "Couldn't remove $What`: $Path" -ForegroundColor Yellow
        $failed.Add($Path)
    }
}

# Stale pre-NyxDB debug CouchDB copies from before the swap, if this
# machine still has one sitting around -- safe to delete outright.
Remove-Path (Join-Path $Root "src-tauri\target\debug\couchdb-dev") "stale pre-NyxDB debug CouchDB copy"
Remove-Path (Join-Path $Root "src-tauri\target\debug\couchdb") "stale pre-E2 debug CouchDB copy"

# This machine's Tauri app-data dir -- the debug files always, the release
# ones only with -IncludeRelease.
$roaming = Join-Path $env:APPDATA "com.offlog.app"
$local = Join-Path $env:LOCALAPPDATA "com.offlog.app"
Remove-Path (Join-Path $roaming "sync-host.dev.json") "debug sync-host config"
Remove-Path (Join-Path $roaming "sync-secret.dev.enc") "debug stored sync credential"
Remove-Path (Join-Path $roaming "nyxdb-data-dev") "debug NyxDB data"
# Stale pre-swap CouchDB data dirs, if any -- distinct names from
# NyxDB's own ("nyxdb-data[-dev]" above), never reused (sled can't read
# CouchDB's on-disk format).
Remove-Path (Join-Path $roaming "couchdb-data-dev") "stale pre-NyxDB debug CouchDB data"
if ($IncludeRelease) {
    Remove-Path (Join-Path $roaming "sync-host.json") "release sync-host config"
    Remove-Path (Join-Path $roaming "sync-secret.enc") "release stored sync credential"
    Remove-Path (Join-Path $roaming "nyxdb-data") "release NyxDB data"
    Remove-Path (Join-Path $roaming "couchdb-data") "stale pre-NyxDB release CouchDB data"
}
# Debug builds' own WebView2 profile (IndexedDB/PouchDB, localStorage).
# The release profile is $local\EBWebView and is never touched here.
Remove-Path (Join-Path $local "webview-dev") "debug WebView2 profile"
# Only the logs folder, never recursively across $local: WebView2 keeps
# IndexedDB journals as *.log files under EBWebView\, and deleting those
# loses the installed app's recent writes. Debug builds write
# Offlog-dev*.log; Offlog.log / Offlog_*.log belong to the installed build.
$logDir = Join-Path $local "logs"
if (Test-Path $logDir) {
    $patterns = @("Offlog-dev*.log")
    if ($IncludeRelease) { $patterns += @("Offlog.log", "Offlog_*.log") }
    foreach ($p in $patterns) {
        Get-ChildItem $logDir -Filter $p -File -ErrorAction SilentlyContinue |
            ForEach-Object { Remove-Path $_.FullName "log" }
    }
}

Write-Host ""
if ($failed.Count) {
    Write-Host "Partial reset -- these could not be removed (is a dev build still running?):" -ForegroundColor Red
    $failed | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
} else {
    Write-Host "Done." -ForegroundColor Green
}
Write-Host "Still manual (can't be scripted from here):" -ForegroundColor Yellow
Write-Host "  - Browser/web PouchDB: open DevTools console on the app and run"
Write-Host "      new PouchDB('offlog').destroy().then(() => localStorage.clear())"
Write-Host "    then reload."
Write-Host "  - Android: adb shell pm clear com.offlog.app.debug  (debug build)"
Write-Host "    or uninstall/reinstall via Android Studio for a true fresh install."
if ($failed.Count) { exit 1 }
exit 0
