@echo off
title Lernplattform - Tests
cd /d "%~dp0"
echo Die automatischen Tests laufen (ca. 3 Minuten). Deine Schuldaten werden nicht angefasst.
"C:\Program Files\nodejs\node.exe" tests\run-tests.js
pause
