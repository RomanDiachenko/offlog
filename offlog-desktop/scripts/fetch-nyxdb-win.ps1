# Builds the NyxDB Windows binary this app bundles as its embedded sync
# host (archive/history.md, Track E / E1). NyxDB (github.com/hrach-gevorgyan/
# nyxdb) doesn't publish prebuilt Windows release binaries the way
# CouchDB's Neighbourhoodie installer does -- this script clones a
# pinned tag and builds it from source with cargo instead. Pinned to the
# tag's commit, not just its name: a tag can be moved to other code, a
# commit id cannot. Bump $Ref and $Commit together, deliberately, in their
# own commit (`git ls-remote --tags <repo> <tag>^{}` prints the commit).
# --locked builds the dependency versions NyxDB's Cargo.lock records, never
# newer ones resolved at build time.
#
# Output is NOT committed to git (~5MB) -- see offlog-desktop/.gitignore.
# Re-run any time vendor/nyxdb-win/ is missing or after bumping $Ref: the
# folder records the tag it was built from in VERSION, and a different tag
# rebuilds it. A folder without VERSION counts as the current tag, since CI
# restores it from a cache keyed on that tag.
# Requires: git, a Rust toolchain (cargo build --release) on PATH.

$ErrorActionPreference = "Stop"

$Ref = "v0.1.7"
$Commit = "fecc0588634e96e11ff1176db890ca5627ba5a28"
$RepoUrl = "https://github.com/hrach-gevorgyan/nyxdb.git"

$Root = Split-Path -Parent $PSScriptRoot
$VendorDir = Join-Path $Root "vendor\nyxdb-win"
$TempClone = Join-Path $env:TEMP "offlog-nyxdb-build-$Ref"

$VersionFile = Join-Path $VendorDir "VERSION"
if ((Test-Path $VendorDir) -and (Test-Path (Join-Path $VendorDir "nyxdb.exe"))) {
    if (-not (Test-Path $VersionFile)) { Set-Content -Path $VersionFile -Value $Ref -NoNewline }
    if ((Get-Content $VersionFile -Raw).Trim() -eq $Ref) {
        Write-Host "vendor\nyxdb-win is already $Ref. Skipping."
        exit 0
    }
    Write-Host "vendor\nyxdb-win was built from another tag; rebuilding as $Ref."
    Remove-Item $VendorDir -Recurse -Force
}

if (Test-Path $TempClone) { Remove-Item $TempClone -Recurse -Force }

Write-Host "Cloning NyxDB $Ref..."
git clone --branch $Ref --depth 1 $RepoUrl $TempClone
if ($LASTEXITCODE -ne 0) {
    Write-Error "git clone failed with exit code $LASTEXITCODE"
    exit 1
}

$actualCommit = (git -C $TempClone rev-parse HEAD)
if ($actualCommit -ne $Commit) {
    Write-Error "$Ref now points at $actualCommit, not the pinned $Commit -- refusing to build."
    exit 1
}
Write-Host "Confirmed checkout is exactly $Ref ($Commit)."

Write-Host "Building NyxDB (release)..."
Push-Location $TempClone
try {
    cargo build --release --locked
    if ($LASTEXITCODE -ne 0) {
        Write-Error "cargo build failed with exit code $LASTEXITCODE"
        exit 1
    }
} finally {
    Pop-Location
}

$builtExe = Join-Path $TempClone "target\release\nyxdb.exe"
if (-not (Test-Path $builtExe)) {
    Write-Error "Expected built binary not found: $builtExe"
    exit 1
}

New-Item -ItemType Directory -Force -Path $VendorDir | Out-Null
Copy-Item $builtExe (Join-Path $VendorDir "nyxdb.exe") -Force
Set-Content -Path $VersionFile -Value $Ref -NoNewline
Write-Host "Copied nyxdb.exe into vendor\nyxdb-win\."

Remove-Item $TempClone -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Done: $VendorDir"
exit 0
