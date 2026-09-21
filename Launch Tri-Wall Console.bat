@echo off
REM ===================================================================
REM  Tri-Wall Console - double-click this file to start the tool.
REM
REM  It is a thin wrapper: all the real work is in launch.ps1, so the
REM  desktop shortcut, this file and run.bat all take the same path
REM  and cannot drift apart.
REM ===================================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
if errorlevel 1 pause
