#!/usr/bin/env pwsh
# Builda o launcher Windows e publica no feed de auto-update do Pi.
# Uso: npm run publish-launcher   (ou direto: pwsh deploy/pi-server/publish-launcher.ps1)
#
# Antes de rodar: bump a versao em package.json ("version"). Sem isso o
# electron-updater nao vai enxergar essa build como mais nova.

param(
    [string]$PiHost = "andrecodato@microlab",
    [string]$RemoteDir = "/srv/umucraft/www/launcher"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Push-Location $repoRoot
try {
    Write-Host ">> Buildando..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build falhou" }

    $version = (Get-Content package.json | ConvertFrom-Json).version
    $exeName = "Umucraft Launcher Setup $version.exe"
    $exePath = "dist\$exeName"

    if (-not (Test-Path $exePath)) {
        throw "Nao encontrei $exePath -- confira se o build gerou essa versao."
    }

    Write-Host ">> Publicando versao $version para ${PiHost}:$RemoteDir ..." -ForegroundColor Cyan
    scp "dist\$exeName" "dist\$exeName.blockmap" "dist\latest.yml" "${PiHost}:~/pi-server/"
    if ($LASTEXITCODE -ne 0) { throw "scp falhou" }

    # sudo vai pedir senha interativa aqui, normal.
    ssh $PiHost "sudo mv ~/pi-server/'$exeName' ~/pi-server/'$exeName.blockmap' ~/pi-server/latest.yml '$RemoteDir/' && sudo chown -R andrecodato:andrecodato '$RemoteDir' && ls -la '$RemoteDir'"
    if ($LASTEXITCODE -ne 0) { throw "publicacao no Pi falhou" }

    Write-Host ">> Publicado! https://umucraft-updates.codato.dev/launcher/latest.yml" -ForegroundColor Green
    Write-Host ">> Players com o launcher aberto recebem a atualizacao no proximo restart." -ForegroundColor Green
}
finally {
    Pop-Location
}
