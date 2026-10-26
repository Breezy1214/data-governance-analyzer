$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$backendFile = Join-Path $root 'backend/.env'
$frontendFile = Join-Path $root 'frontend/.env.local'
if ((Test-Path $backendFile) -or (Test-Path $frontendFile)) {
    throw 'Local configuration already exists. Edit it in VS Code; this script will not replace existing keys.'
}
function New-Key {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_')
}
$shared = New-Key
$encryption = New-Key
@"
APP_ENV=development
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
FRONTEND_SHARED_KEY=$shared
SESSION_ENCRYPTION_KEY=$encryption
AUTH_DATABASE_PATH=.local/auth.sqlite3
AUTH_IDLE_SECONDS=1800
AUTH_MAX_SECONDS=28800
"@ | Set-Content -LiteralPath $backendFile -Encoding utf8
@"
API_BASE_URL=http://127.0.0.1:8022
APP_ORIGIN=http://localhost:3022
FRONTEND_SHARED_KEY=$shared
"@ | Set-Content -LiteralPath $frontendFile -Encoding utf8
Write-Output 'Local keys created. Add the Supabase URL and publishable key to backend/.env when available. Keys were not printed.'
