@echo off
start "" /b powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0production-vault-transfer.ps1" -Mode Transfer
exit /b
