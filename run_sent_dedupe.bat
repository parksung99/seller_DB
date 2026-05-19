@echo off
cd /d "%~dp0"
".tools\node-v22.22.3-win-x64\node.exe" "scripts\mark_sent_handles_dedupe.mjs" %*
pause
