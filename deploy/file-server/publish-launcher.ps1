#!/usr/bin/env pwsh
# Builda o launcher Windows e publica no feed de auto-update do file-server.
# Uso: npm run publish-launcher   (ou direto: pwsh deploy/file-server/publish-launcher.ps1)
#
# Antes de rodar: bump a versao em package.json ("version"). Sem isso o
# electron-updater nao vai enxergar essa build como mais nova.

param(
    [string]$RemoteHost = "root@192.168.201.26",
    [string]$RemoteDir = "/srv/umucraft/www/launcher",
    [string]$RemoteOwner = "andrecodato"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Push-Location $repoRoot
try {
    Write-Host ">> Buildando..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build falhou" }

    $version = (Get-Content package.json | ConvertFrom-Json).version
    $exeName = "UmuCraftLauncher-Setup-$version.exe"
    $exePath = "dist\$exeName"

    if (-not (Test-Path $exePath)) {
        throw "Nao encontrei $exePath -- confira se o build gerou essa versao."
    }

    Write-Host ">> Publicando versao $version para ${RemoteHost}:$RemoteDir ..." -ForegroundColor Cyan
    scp "dist\$exeName" "dist\$exeName.blockmap" "dist\latest.yml" "${RemoteHost}:/tmp/"
    if ($LASTEXITCODE -ne 0) { throw "scp falhou" }

    # sudo pode pedir senha interativa se o remote nao for root.
    ssh $RemoteHost "mv /tmp/'$exeName' /tmp/'$exeName.blockmap' /tmp/latest.yml '$RemoteDir/' && chown -R ${RemoteOwner}:${RemoteOwner} '$RemoteDir' && ls -la '$RemoteDir'"
    if ($LASTEXITCODE -ne 0) { throw "publicacao no file-server falhou" }

    Write-Host ">> Publicado! https://umucraft-updates.codato.dev/launcher/latest.yml" -ForegroundColor Green
    Write-Host ">> Players com o launcher aberto recebem a atualizacao no proximo restart." -ForegroundColor Green
}
finally {
    Pop-Location
}
