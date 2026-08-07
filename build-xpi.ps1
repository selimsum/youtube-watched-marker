#!/usr/bin/env pwsh
# Build .xpi file from the extension source using web-ext

$ErrorActionPreference = 'Stop'

$artifactsDir = "web-ext-artifacts"

# Ensure web-ext is available
if (-not (Test-Path "node_modules\.bin\web-ext.cmd")) {
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    npm install
}

# Lint first
Write-Host "Linting..." -ForegroundColor Cyan
& npx web-ext lint --source-dir . --ignore-files package.json package-lock.json node_modules web-ext-artifacts README.md
if ($LASTEXITCODE -ne 0) {
    Write-Host "Lint failed!" -ForegroundColor Red
    exit 1
}

# Build zip
Write-Host "Building..." -ForegroundColor Cyan
& npx web-ext build --source-dir . --artifacts-dir $artifactsDir --overwrite-dest --ignore-files package.json package-lock.json node_modules web-ext-artifacts README.md
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

# Rename latest zip to .xpi
$zip = Get-ChildItem "$artifactsDir\*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) {
    Write-Host "No zip file found in $artifactsDir" -ForegroundColor Red
    exit 1
}

$xpiPath = Join-Path $artifactsDir "youtube_watched_marker.xpi"
Copy-Item $zip.FullName $xpiPath -Force
Write-Host "Created $xpiPath" -ForegroundColor Green
