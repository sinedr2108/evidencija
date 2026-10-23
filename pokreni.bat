@echo off
rem Podesite po potrebi (maknite "rem" ispred reda):
rem set PORT=3000
rem set SMTP_HOST=smtp.vasadomena.hr
rem set SMTP_PORT=587
rem set SMTP_USER=izvjestaji@vasadomena.hr
rem set SMTP_PASS=lozinka
rem set MAIL_FROM=izvjestaji@vasadomena.hr
cd /d "%~dp0"
node server.js
pause
