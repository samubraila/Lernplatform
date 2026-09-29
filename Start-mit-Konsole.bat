@echo off
title Lernplattform
cd /d "%~dp0"
echo Lernplattform startet ... (Fenster offen lassen, zum Beenden schliessen)
"C:\Program Files\nodejs\node.exe" server.js
pause
