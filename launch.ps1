# ===================================================================
#  Tri-Wall Console - launcher
#
#  Started by "Launch Tri-Wall Console.bat" (or the desktop shortcut).
#  Nothing here asks for a password, key or token.
#
#  Three things this does that the plain `node server.js` path did not:
#    1. If a console is ALREADY running on the port, it just opens the
#       browser instead of starting a second one and dying on EADDRINUSE.
#    2. It waits until the server actually answers before opening the
#       browser, so you never land on "can't reach this page".
#    3. It stops the server cleanly when the window is closed.
# ===================================================================

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$port = $env:TRIWALL_PORT
if ([string]::IsNullOrWhiteSpace($port)) { $port = '8934' }
$base = "http://localhost:$port"

$Host.UI.RawUI.WindowTitle = "Tri-Wall Console"
Write-Host ""
Write-Host "  TRI-WALL CONSOLE" -ForegroundColor Cyan
Write-Host "  ================" -ForegroundColor Cyan
Write-Host ""

# Is one already up? Reuse it rather than fighting for the port.
function Test-Console {
    param([int]$TimeoutSec = 2)
    try {
        $r = Invoke-WebRequest -Uri "$base/api/state" -UseBasicParsing -TimeoutSec $TimeoutSec
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

if (Test-Console -TimeoutSec 2) {
    Write-Host "  The console is already running on $base" -ForegroundColor Green
    Write-Host "  Opening it in your browser."
    Start-Process $base
    Write-Host ""
    Write-Host "  Nothing else to do - you can close this window."
    Start-Sleep -Seconds 3
    exit 0
}

# ---- Node (required) ----
$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
    Write-Host "  [X] Node.js is not installed." -ForegroundColor Red
    Write-Host "      Install the LTS build from https://nodejs.org then run this again."
    Write-Host ""
    Read-Host "  Press Enter to close"
    exit 1
}
Write-Host ("  [ok] Node " + (& node --version)) -ForegroundColor Green

# ---- the one npm dependency ----
if (-not (Test-Path "node_modules\cross-spawn")) {
    Write-Host "  [..] First run - installing the one npm dependency..."
    & npm install --no-audit --no-fund 2>&1 | Out-Null
    if (-not (Test-Path "node_modules\cross-spawn")) {
        Write-Host "  [X] npm install failed. Run 'npm install' in this folder and read the error." -ForegroundColor Red
        Read-Host "  Press Enter to close"
        exit 1
    }
}
Write-Host "  [ok] Dependencies" -ForegroundColor Green

# ---- optional: python libs for reference decoding + self-calibration ----
$py = Get-Command python -ErrorAction SilentlyContinue
if ($null -ne $py) {
    & python -c "import numpy,cv2" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [..] Installing numpy + opencv for reference decoding (optional, one time)..."
        & python -m pip install --quiet numpy opencv-python-headless 2>&1 | Out-Null
        & python -c "import numpy,cv2" 2>$null
    }
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [ok] Reference decoding ready" -ForegroundColor Green
    } else {
        Write-Host "  [--] Decoding unavailable - install numpy/opencv later if you want it." -ForegroundColor Yellow
    }
} else {
    Write-Host "  [--] Python not found - reference decoding and self-calibration are off." -ForegroundColor Yellow
    Write-Host "       Everything else works. Install Python 3.10+ to enable them."
}

# ---- start it ----
Write-Host ""
Write-Host "  Starting on $base"
$env:TRIWALL_PORT = $port
# -NoNewWindow so the server's own log lands in THIS window; the caller keeps
# the handle so it can be stopped again when the window closes.
$proc = Start-Process -FilePath "node" -ArgumentList "server.js" -NoNewWindow -PassThru

# Wait for it to actually answer before opening a browser at it.
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) { break }
    if (Test-Console -TimeoutSec 1) { $ready = $true; break }
}

if (-not $ready) {
    Write-Host ""
    if ($proc.HasExited) {
        Write-Host "  [X] The server stopped straight away - the error is above." -ForegroundColor Red
        Write-Host "      A port clash is the usual cause: something else may be on $port."
        Write-Host "      Run with a different port:  set TRIWALL_PORT=8935  then start this again."
    } else {
        Write-Host "  [X] The server did not answer within 20 seconds." -ForegroundColor Red
        Write-Host "      It may still be starting - try $base in your browser."
    }
    Write-Host ""
    Read-Host "  Press Enter to close"
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    exit 1
}

Start-Process $base
Write-Host ""
Write-Host "  Open at $base" -ForegroundColor Green
Write-Host "  The Connections panel at the top tells you if you still need to sign in."
Write-Host ""
Write-Host "  Leave this window open. Closing it stops the server." -ForegroundColor Yellow
Write-Host ""

try {
    Wait-Process -Id $proc.Id
} finally {
    # Covers the window being closed outright, not just the server exiting.
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
}

Write-Host ""
Write-Host "  Server stopped."
Start-Sleep -Seconds 2
