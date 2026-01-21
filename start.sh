#!/bin/bash

echo "==============================================="
echo "     Ollama Phone Chat Bridge Launcher"
echo "==============================================="

# 1. Check Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed. Please install it."
    exit 1
fi

# 2. Install dependencies if node_modules missing
if [ ! -d "node_modules" ]; then
    echo "[INFO] Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "[ERROR] npm install failed."
        exit 1
    fi
fi

# 3. Detect Ollama
echo "[INFO] Checking for local Ollama..."
if curl -s http://localhost:11434/api/tags > /dev/null; then
    echo "[SUCCESS] Local Ollama detected! Starting in Local Mode..."
    export MODE=local
else
    echo "[WARN] Local Ollama not running or not found."
    read -p "Do you want to use Ollama Cloud / API Key mode? (Y/N): " USE_CLOUD
    if [[ "$USE_CLOUD" =~ ^[Yy]$ ]]; then
        export MODE=cloud
        echo "[INFO] Starting in Cloud Mode..."
    else
        echo "[INFO] Please start Ollama or configure API key in .env"
        echo "[INFO] Starting anyway..."
        export MODE=auto
    fi
fi

# 4. Start Server
echo ""
echo "[INFO] Starting Server..."
npm start
