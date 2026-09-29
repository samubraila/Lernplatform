@echo off
title Lernplattform - EXE bauen
cd /d "%~dp0"
echo Baue dist\Lernplattform.exe ...
"C:\Program Files\nodejs\node.exe" tools\build-exe.js
pause
