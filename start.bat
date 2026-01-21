@echo off
setlocal

echo ===============================================
echo      Ollama Phone Chat Bridge Launcher
echo ===============================================

:: 1. Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed. Please install it from https://nodejs.org/
    pause
    exit /b 1
)

:: 2. Install dependencies if node_modules missing
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

:: 3. Detect Ollama
echo [INFO] Checking for local Ollama...
curl -s http://localhost:11434/api/tags >nul
if %errorlevel% equ 0 (
    echo [SUCCESS] Local Ollama detected! Starting in Local Mode...
    set MODE=local
) else (
    echo [WARN] Local Ollama not running or not found.
    echo.
    set /p USE_CLOUD="Do you want to use Ollama Cloud / API Key mode? (Y/N): "
    if /i "%USE_CLOUD%"=="Y" (
        set MODE=cloud
        echo [INFO] Starting in Cloud Mode...
    ) else (
        echo [INFO] Please start Ollama or configure API key in .env
        echo [INFO] Starting anyway to let you configure via UI...
        set MODE=auto
    )
)

:: 4. Start Server
echo.
echo [INFO] Starting Server...
npm start

pause
