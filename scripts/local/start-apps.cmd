@echo off
set PATH=C:\Program Files\nodejs;%PATH%
cd /d "%~dp0..\.."

start "calls-api" /D "%cd%" cmd /c "node scripts\local\run-service.js api --dist || pause"
start "calls-media" /D "%cd%" cmd /c "node scripts\local\run-service.js media --dist || pause"
start "calls-transcriber" /D "%cd%" cmd /c "node scripts\local\run-service.js transcriber --dist || pause"
start "calls-analyzer" /D "%cd%" cmd /c "node scripts\local\run-service.js analyzer --dist || pause"

echo STARTED
echo интерфейс: npm run dev:web
