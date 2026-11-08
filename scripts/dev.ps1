# Starts the engine (http://127.0.0.1:8000) and the web app (http://localhost:5173).
# Press Ctrl+C to stop both.
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root "engine\.venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    Write-Error "Engine virtualenv missing. See README.md > Setup."
    exit 1
}
if (-not (Test-Path (Join-Path $root "web\node_modules"))) {
    Write-Error "Web dependencies missing. Run: cd web; npm install"
    exit 1
}

# Load engine/.env (KEY=VALUE lines) into this process so the engine inherits it.
$envFile = Join-Path $root "engine\.env"
if (Test-Path $envFile) {
    Get-Content $envFile | Where-Object { $_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$' } | ForEach-Object {
        if ($Matches[2] -ne "") { Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2] }
    }
}

$engine = Start-Process -PassThru -NoNewWindow -WorkingDirectory (Join-Path $root "engine") `
    -FilePath $python -ArgumentList "-m", "uvicorn", "resume_engine.api.main:app", "--reload", "--port", "8000"

try {
    Push-Location (Join-Path $root "web")
    npm run dev
}
finally {
    Pop-Location
    if (-not $engine.HasExited) { Stop-Process -Id $engine.Id -Force }
}
