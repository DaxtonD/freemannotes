#!/usr/bin/env pwsh
# ─────────────────────────────────────────────────────────────────────────────
# Build and run Freeman Notes locally in Docker, pointed at your EXTERNAL Postgres
# + Redis (e.g. your Unraid containers). Connection settings live in .env.docker.
#
#   .\scripts\run-docker.ps1          Build from the current code + start (default)
#   .\scripts\run-docker.ps1 -Down    Stop and remove the container
#   .\scripts\run-docker.ps1 -Logs    Follow the container logs
#
# First run copies .env.docker.example to .env.docker and asks you to fill in your
# Postgres/Redis IPs before starting.
# ─────────────────────────────────────────────────────────────────────────────
param(
    [switch]$Down,
    [switch]$Logs
)

$ErrorActionPreference = 'Stop'
# Run from the repo root regardless of where the script is invoked from.
Set-Location (Join-Path $PSScriptRoot '..')

$compose = @('compose', '-f', 'docker-compose.local.yml', '--env-file', '.env.docker')

if ($Down) {
    docker @compose down
    exit $LASTEXITCODE
}

if ($Logs) {
    docker @compose logs -f
    exit $LASTEXITCODE
}

if (-not (Test-Path '.env.docker')) {
    Copy-Item '.env.docker.example' '.env.docker'
    Write-Host ''
    Write-Host 'Created .env.docker from the example.' -ForegroundColor Yellow
    Write-Host 'Edit it and set DATABASE_URL and REDIS_URL to your Postgres/Redis' -ForegroundColor Yellow
    Write-Host 'container IP addresses and ports, then run this script again:' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  DATABASE_URL=postgresql://USER:PASS@POSTGRES_IP:5432/DBNAME?schema=public'
    Write-Host '  REDIS_URL=redis://REDIS_IP:6379'
    Write-Host ''
    Write-Host 'Tip: pointing DATABASE_URL at your PRODUCTION database gives the truest'
    Write-Host 'repro, but the app reads AND writes it. Use a dev/throwaway DB, or set'
    Write-Host 'DB_SCHEMA_SYNC=none in .env.docker, if you want to be conservative.'
    exit 1
}

Write-Host 'Building and starting Freeman Notes (rebuilds from your current code)...' -ForegroundColor Cyan
docker @compose up -d --build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ''
Write-Host 'Freeman Notes is running at http://localhost:27015' -ForegroundColor Green
Write-Host 'Force virtualization (bug repro):  http://localhost:27015/?forceVirtualization=1'
Write-Host ''
Write-Host 'Logs:  .\scripts\run-docker.ps1 -Logs'
Write-Host 'Stop:  .\scripts\run-docker.ps1 -Down'
