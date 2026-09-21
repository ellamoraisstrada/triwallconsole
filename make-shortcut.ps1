# Puts a "Tri-Wall Console" shortcut on your desktop, pointing at the launcher
# in this folder. Run it once:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\make-shortcut.ps1
#
# Right-click the shortcut afterwards and choose "Pin to taskbar" if you want it
# permanently to hand. Nothing here asks for a password, key or token.
#
# ASCII only, saved with a BOM and CRLF endings on purpose: read without one,
# Windows PowerShell decodes a UTF-8 em dash into a smart quote and then treats
# it as a string delimiter, which breaks the script in a very confusing way.

$ErrorActionPreference = 'Stop'

$app    = $PSScriptRoot
$target = Join-Path $app 'Launch Tri-Wall Console.bat'

if (-not (Test-Path $target)) {
    Write-Host "[X] Could not find 'Launch Tri-Wall Console.bat' next to this script." -ForegroundColor Red
    Write-Host "    Run this from inside the tool's folder."
    exit 1
}

$desktop = [Environment]::GetFolderPath('Desktop')
$lnk     = Join-Path $desktop 'Tri-Wall Console.lnk'

$shell    = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnk)
$shortcut.TargetPath       = $target
$shortcut.WorkingDirectory = $app
$shortcut.Description      = 'Start the Tri-Wall immersive theatre console and open it in your browser'
$shortcut.IconLocation     = "$env:SystemRoot\System32\SHELL32.dll,137"
$shortcut.Save()

if (Test-Path $lnk) {
    Write-Host ""
    Write-Host "  Done. There is now a 'Tri-Wall Console' shortcut on your desktop." -ForegroundColor Green
    Write-Host "  Double-click it to start the tool. Right-click it to pin it to the taskbar."
    Write-Host ""
} else {
    Write-Host "[X] The shortcut could not be created." -ForegroundColor Red
    exit 1
}
