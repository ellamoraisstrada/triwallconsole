@echo off
REM ===================================================================
REM  Tri-Wall Console - Windows launcher
REM
REM  Kept as the documented entry point for the team package. The logic
REM  now lives in launch.ps1 so this file, "Launch Tri-Wall Console.bat"
REM  and the desktop shortcut cannot drift apart. The old version of
REM  this script opened the browser before the server was listening and
REM  died on a port clash when a console was already running.
REM ===================================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
if errorlevel 1 pause
