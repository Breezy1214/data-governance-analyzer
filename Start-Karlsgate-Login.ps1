$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
foreach ($port in @(3022,8022)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use. No existing process was stopped."
    }
}
if (-not (Test-Path (Join-Path $root 'backend/.env'))) { & (Join-Path $root 'scripts/setup-local.ps1') }
$python = Join-Path $root 'backend/.venv/Scripts/python.exe'
$node = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path $python)) { throw 'Install backend dependencies first; see README.md.' }
$logs = Join-Path $root '.local'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$api = Start-Process -FilePath $python -WorkingDirectory (Join-Path $root 'backend') -WindowStyle Hidden -PassThru `
    -ArgumentList '-m uvicorn app.main:app --host 127.0.0.1 --port 8022 --env-file .env' `
    -RedirectStandardOutput (Join-Path $logs 'backend.log') -RedirectStandardError (Join-Path $logs 'backend-error.log')
$web = Start-Process -FilePath $node -WorkingDirectory (Join-Path $root 'frontend') -WindowStyle Hidden -PassThru `
    -ArgumentList 'node_modules/next/dist/bin/next dev --hostname localhost --port 3022' `
    -RedirectStandardOutput (Join-Path $logs 'frontend.log') -RedirectStandardError (Join-Path $logs 'frontend-error.log')
@{backend=$api.Id; frontend=$web.Id} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logs 'processes.json')
Write-Output 'Karlsgate login starting: http://localhost:3022/login (logs in .local). Real login requires Supabase configuration.'
