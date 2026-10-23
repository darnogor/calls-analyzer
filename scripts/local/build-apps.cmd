@echo off
set PATH=C:\Program Files\nodejs;%PATH%
cd /d "%~dp0..\.."

call npm run build -w @calls/db
if errorlevel 1 exit /b 1

call npm run build -w @calls/chat-completions
if errorlevel 1 exit /b 1

for %%S in (api media transcriber analyzer) do (
  call npm run build -w @calls/%%S
  if errorlevel 1 exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wait-postgres.ps1"
if errorlevel 1 exit /b 1

node -r ./scripts/local/load-env.cjs apps/api/dist/migrate.js
if errorlevel 1 exit /b 1

echo BUILD_OK
