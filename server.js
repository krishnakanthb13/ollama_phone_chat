require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const os = require('os');
const qrcode = require('qrcode-terminal');
const db = require('./db');

// Dynamic import for node-fetch
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth Middleware
const APP_PASSWORD = process.env.APP_PASSWORD;

function authMiddleware(req, res, next) {
    if (!APP_PASSWORD) return next(); // No password set = allow all

    const providedPassword = req.headers['x-app-password'];
    if (providedPassword === APP_PASSWORD) return next();

    res.status(401).json({ error: 'Unauthorized. Password required.' });
}

// Global state
let currentMode = 'detecting'; // 'local', 'cloud', 'none'
let localOllamaUrl = 'http://localhost:11434';
let cloudOllamaUrl = 'https://ollama.com/api';

// --- Helper Functions ---

const fs = require('fs');

// Cache file path
const CACHE_FILE = path.join(__dirname, 'models_cache.json');

// --- Helper Functions ---

async function saveModelsToCache(models) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify({ models }));
        console.log(`[INFO] Models cached to ${CACHE_FILE}`);
    } catch (e) {
        console.error('[WARN] Failed to cache models:', e.message);
    }
}

function loadModelsFromCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf8');
            const json = JSON.parse(data);
            console.log(`[INFO] Loaded ${json.models.length} models from cache.`);
            return json;
        }
    } catch (e) {
        console.error('[WARN] Failed to load models from cache:', e.message);
    }
    return { models: [] };
}

async function detectOllama() {
    const mode = process.env.MODE || 'auto';

    if (mode === 'cloud') {
        currentMode = 'cloud';
        console.log('Mode set to CLOUD (forced)');
        return;
    }

    try {
        const response = await fetch(`${localOllamaUrl}/api/tags`);
        if (response.ok) {
            currentMode = 'local';
            console.log('Local Ollama detected. Mode: LOCAL');

            // Cache models immediately on startup
            try {
                const data = await response.json();
                if (data.models) saveModelsToCache(data.models);
            } catch (err) {
                console.error('Failed to cache initial models:', err);
            }

        } else {
            throw new Error('Local Ollama not responding');
        }
    } catch (error) {
        if (mode === 'local') {
            console.error('Local mode forced but Ollama not running!', error.message);
            currentMode = 'none';
        } else if (process.env.OLLAMA_API_KEY) {
            currentMode = 'cloud';
            console.log('Local Ollama not found. Mode: CLOUD (fallback)');
        } else {
            currentMode = 'cloud'; // Default to cloud/cache if no local, even if no key (for model listing)
            console.log('Local Ollama not found. Mode: CLOUD (fallback/cache)');
        }
    }
}

function getLanIp() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

// --- API Routes ---

// Status Check (Always public)
app.get('/api/status', (req, res) => {
    res.json({
        mode: currentMode,
        connected: currentMode !== 'none',
        lanIp: getLanIp(),
        port: PORT,
        authRequired: !!APP_PASSWORD // Tell frontend if auth is needed
    });
});

// Login/Verify Endpoint
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (!APP_PASSWORD || password === APP_PASSWORD) {
        return res.json({ success: true });
    }
    res.status(401).json({ error: 'Invalid password' });
});

// Apply auth to all other API routes
app.use('/api', authMiddleware);

// List Models
app.get('/api/models', async (req, res) => {
    // If in cloud mode (or fallback), try to serve from cache
    if (currentMode === 'cloud' || currentMode === 'none') {
        const cached = loadModelsFromCache();
        return res.json(cached);
    }

    try {
        const targetUrl = `${localOllamaUrl}/api/tags`;
        const response = await fetch(targetUrl);
        if (!response.ok) throw new Error('Failed to fetch models');

        const data = await response.json();

        // Update cache on successful fetch
        if (data.models) saveModelsToCache(data.models);

        res.json(data);
    } catch (error) {
        console.error('Model fetch error:', error);
        // Fallback to cache if live fetch fails even in local mode
        const cached = loadModelsFromCache();
        if (cached.models.length > 0) return res.json(cached);

        res.status(500).json({ error: 'Failed to list models' });
    }
});

// Chat History: Get all chats
app.get('/api/chats', async (req, res) => {
    try {
        const chats = await db.all('SELECT * FROM chats ORDER BY updated_at DESC');
        res.json(chats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Chat History: Create new chat
app.post('/api/chats', async (req, res) => {
    try {
        const { title, model } = req.body;
        const result = await db.run('INSERT INTO chats (title, model) VALUES (?, ?)', [title || 'New Chat', model]);
        const newChat = await db.get('SELECT * FROM chats WHERE id = ?', [result.id]);
        res.json(newChat);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Chat History: Get specific chat messages
app.get('/api/chats/:id', async (req, res) => {
    try {
        const chat = await db.get('SELECT * FROM chats WHERE id = ?', [req.params.id]);
        if (!chat) return res.status(404).json({ error: 'Chat not found' });

        const messages = await db.all('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC', [req.params.id]);
        res.json({ ...chat, messages });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Chat History: Delete chat
app.delete('/api/chats/:id', async (req, res) => {
    try {
        await db.run('DELETE FROM chats WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Streaming Chat
app.post('/api/chat', async (req, res) => {
    if (currentMode === 'none') return res.status(503).json({ error: 'No Ollama connection' });

    let { messages, model, stream, chatId, options, think } = req.body;

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // If new chat requested (chatId is null), create one seamlessly
    if (!chatId) {
        try {
            // Use first message as title or "New Chat"
            const firstUserMsg = messages.find(m => m.role === 'user');
            const title = firstUserMsg ? firstUserMsg.content.substring(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '') : 'New Chat';
            const result = await db.run('INSERT INTO chats (title, model) VALUES (?, ?)', [title, model]);
            chatId = result.id;
            // Send the new chatId to client immediately via a special event
            res.write(`data: ${JSON.stringify({ type: 'chat_created', chatId: chatId })}\n\n`);
        } catch (e) {
            console.error("Failed to auto-create chat:", e);
        }
    }

    // Save latest user message if chatId exists
    if (chatId) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'user') {
            try {
                await db.run('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)', [chatId, 'user', lastMsg.content]);

                // Update chat timestamp and model
                await db.run('UPDATE chats SET updated_at = CURRENT_TIMESTAMP, model = ? WHERE id = ?', [model, chatId]);
            } catch (err) {
                console.error('Error saving user message:', err);
            }
        }
    }

    try {
        const targetUrl = currentMode === 'local' ? `${localOllamaUrl}/api/chat` : `${cloudOllamaUrl}/chat`;
        const headers = { 'Content-Type': 'application/json' };
        if (currentMode === 'cloud') headers['Authorization'] = `Bearer ${process.env.OLLAMA_API_KEY}`;

        const body = {
            model,
            messages,
            stream: true,
            options,
            ...(think && think !== 'none' ? { think } : {})
        };

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            res.write(`data: ${JSON.stringify({ error: `Ollama API Error: ${response.statusText}` })}\n\n`);
            return res.end();
        }

        let assistantContent = '';
        let assistantThinking = '';

        let buffer = '';

        // Process the stream
        for await (const chunk of response.body) {
            buffer += chunk.toString();
            const lines = buffer.split('\n');

            // Keep the last line in buffer as it might be incomplete
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const json = JSON.parse(line);
                    res.write(`data: ${JSON.stringify(json)}\n\n`);

                    if (json.message?.content) {
                        assistantContent += json.message.content;
                    }
                    // Experimental: capture thinking
                    if (json.message?.thinking) {
                        assistantThinking += json.message.thinking;
                    }

                    if (json.done && chatId) {
                        // Save assistant message to DB
                        await db.run('INSERT INTO messages (chat_id, role, content, thinking) VALUES (?, ?, ?, ?)', [chatId, 'assistant', assistantContent, assistantThinking]);
                    }
                } catch (e) {
                    // This creates noise for occasional non-fatal flush errors, but primary parsing should be fixed by buffer
                    // console.error('Error parsing line:', e.message); 
                }
            }
        }

        // Process any remaining buffer (shouldn't be any for valid ndjson but good practice)
        if (buffer.trim()) {
            try {
                const json = JSON.parse(buffer);
                res.write(`data: ${JSON.stringify(json)}\n\n`);
            } catch (e) { }
        }

        res.end();

    } catch (error) {
        console.error('Chat error:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

// Start Server
detectOllama().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        const lanIp = getLanIp();
        const url = `http://${lanIp}:${PORT}`;

        console.log('\n=======================================');
        console.log(`🚀 Ollama Phone Chat Bridge Running!`);
        console.log(`📱 Connect your phone to: ${url}`);
        console.log('=======================================\n');

        qrcode.generate(url, { small: true });
    });
});
