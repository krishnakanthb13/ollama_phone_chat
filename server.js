'use strict';

const express = require('express');
const path = require('path');
const http = require('http');
const os = require('os');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const qrcode = require('qrcode-terminal');

const config = require('./config');
const db = require('./db');

// Node.js ships a global fetch implementation. Using it removes the
// undeclared `node-fetch` dependency that previously broke every chat request
// after a clean `npm install`.
if (typeof globalThis.fetch !== 'function') {
    console.error('[FATAL] Node.js 20.17 or newer is required (global fetch is unavailable).');
    process.exit(1);
}

const VERSION = require('./package.json').version;
const app = express();

const MAX_MESSAGES = 200;
const MAX_CONTENT_CHARS = 100000;
const ROLES = new Set(['user', 'assistant', 'system']);
const ALLOWED_OPTIONS = new Set([
    'temperature', 'top_p', 'top_k', 'num_predict', 'seed', 'stop',
    'repeat_penalty', 'num_ctx', 'web_search',
]);

let server = null;
let healthTimer = null;
let mode = config.mode === 'local' ? 'local' : config.mode === 'cloud' ? 'cloud' : 'detecting';
let lastDetectAt = 0;
let detectInFlight = null;

// --- Small helpers ---

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function asyncHandler(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function safeEqual(provided, expected) {
    const a = Buffer.from(String(provided));
    const b = Buffer.from(String(expected));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function upstreamError(status, text) {
    let message = '';
    try {
        const parsed = JSON.parse(text);
        message = parsed.error || parsed.message || '';
    } catch (e) {
        message = text;
    }
    message = String(message || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
    return `Ollama API error (${status})${message ? `: ${message}` : ''}`;
}

async function readResponseText(response, max = 2000) {
    try {
        return (await response.text()).slice(0, max);
    } catch (e) {
        return '';
    }
}

function makeTitle(text) {
    const clean = String(text || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!clean) return 'New Chat';
    const chars = Array.from(clean);
    return chars.length > 30 ? `${chars.slice(0, 30).join('')}...` : clean;
}

function sanitizeOptions(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return undefined;
    const clean = {};
    for (const [key, value] of Object.entries(options)) {
        if (!ALLOWED_OPTIONS.has(key)) continue;
        if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
        else if (typeof value === 'boolean') clean[key] = value;
        else if (typeof value === 'string' && value.length <= 200) clean[key] = value;
        else if (Array.isArray(value) && value.length <= 20 && value.every((item) => typeof item === 'string' && item.length <= 200)) {
            clean[key] = value;
        }
    }
    return Object.keys(clean).length ? clean : undefined;
}

function validateChatPayload(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return 'Request body must be a JSON object.';
    }

    const { messages, model, chatId, options, think, clientMessageId } = body;

    if (typeof model !== 'string' || !model.trim() || model.length > 200) {
        return 'A non-empty "model" string is required.';
    }
    if (!Array.isArray(messages) || messages.length === 0) {
        return '"messages" must be a non-empty array.';
    }
    if (messages.length > MAX_MESSAGES) {
        return `Too many messages (maximum ${MAX_MESSAGES}).`;
    }

    for (let i = 0; i < messages.length; i += 1) {
        const message = messages[i];
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
            return `messages[${i}] must be an object.`;
        }
        if (!ROLES.has(message.role)) {
            return `messages[${i}].role must be "user", "assistant", or "system".`;
        }
        if (typeof message.content !== 'string') {
            return `messages[${i}].content must be a string.`;
        }
        if (message.content.length > MAX_CONTENT_CHARS) {
            return `messages[${i}].content is too long.`;
        }
    }

    if (chatId !== undefined && chatId !== null && chatId !== '') {
        const parsed = typeof chatId === 'number'
            ? chatId
            : (typeof chatId === 'string' && /^[0-9]+$/.test(chatId) ? Number(chatId) : NaN);
        if (!Number.isInteger(parsed) || parsed <= 0) {
            return '"chatId" must be a positive integer.';
        }
    }

    if (clientMessageId !== undefined && clientMessageId !== null) {
        if (typeof clientMessageId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(clientMessageId)) {
            return '"clientMessageId" must be 1-100 characters of A-Z, a-z, 0-9, _ or -.';
        }
    }

    if (think !== undefined && think !== null && think !== 'none'
        && think !== true && think !== false
        && think !== 'low' && think !== 'medium' && think !== 'high') {
        return '"think" must be a boolean, "low", "medium", "high", or "none".';
    }

    if (options !== undefined && options !== null && (typeof options !== 'object' || Array.isArray(options))) {
        return '"options" must be an object.';
    }

    return null;
}

// --- Model cache ---

async function saveModelsToCache(models) {
    if (!Array.isArray(models)) return;
    const tmpFile = `${config.modelsCacheFile}.${process.pid}.tmp`;
    try {
        await fsp.mkdir(path.dirname(config.modelsCacheFile), { recursive: true });
        await fsp.writeFile(tmpFile, JSON.stringify({ models, cachedAt: new Date().toISOString() }));
        await fsp.rename(tmpFile, config.modelsCacheFile);
    } catch (error) {
        console.error('[WARN] Failed to write models cache:', error.message);
        try { await fsp.unlink(tmpFile); } catch (e) { /* ignore */ }
    }
}

function loadModelsFromCache() {
    try {
        const parsed = JSON.parse(fs.readFileSync(config.modelsCacheFile, 'utf8'));
        return {
            models: Array.isArray(parsed.models) ? parsed.models : [],
            cachedAt: parsed.cachedAt || null,
        };
    } catch (e) {
        return { models: [], cachedAt: null };
    }
}

// --- Ollama detection ---

async function fetchOllamaTags(url, withAuth = false) {
    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        Math.min(config.detectTimeoutMs, config.requestTimeoutMs)
    );
    try {
        const headers = {};
        if (withAuth) headers.Authorization = `Bearer ${config.cloudApiKey}`;
        const response = await fetch(url, { headers, signal: controller.signal });
        const text = await readResponseText(response, 1024 * 1024);
        if (!response.ok) throw new Error(upstreamError(response.status, text));
        try {
            return JSON.parse(text);
        } catch (e) {
            throw new Error('Ollama returned invalid JSON.');
        }
    } finally {
        clearTimeout(timeout);
    }
}

async function detectOllama({ force = false } = {}) {
    if (config.mode === 'local') {
        mode = 'local';
        return mode;
    }
    if (config.mode === 'cloud') {
        mode = config.cloudApiKey ? 'cloud' : 'none';
        return mode;
    }
    if (detectInFlight) return detectInFlight;
    if (!force && Date.now() - lastDetectAt < 5000) return mode;

    detectInFlight = (async () => {
        lastDetectAt = Date.now();
        try {
            const data = await fetchOllamaTags(`${config.localOllamaUrl}/api/tags`);
            if (mode !== 'local') console.log('Local Ollama detected. Mode: LOCAL');
            mode = 'local';
            await saveModelsToCache(Array.isArray(data.models) ? data.models : []);
        } catch (error) {
            const next = config.cloudApiKey ? 'cloud' : 'none';
            if (mode !== next) console.log(`Local Ollama not available. Mode: ${next.toUpperCase()}`);
            mode = next;
        }
        return mode;
    })().finally(() => {
        detectInFlight = null;
    });

    return detectInFlight;
}

function startModeWatcher() {
    if (config.mode !== 'auto' || healthTimer) return;
    healthTimer = setInterval(() => {
        detectOllama({ force: true }).catch(() => {});
    }, config.healthIntervalMs);
    if (healthTimer.unref) healthTimer.unref();
}

// --- Networking ---

// Virtual adapters (Hyper-V, WSL, Docker, VPNs) are frequently the first
// non-internal IPv4 address, but phones cannot reach them. Score interfaces
// so the printed QR code points at a real LAN address.
const VIRTUAL_INTERFACE = /(vethernet|virtualbox|vmware|hyper-?v|wsl|docker|br-|virbr|tun\d|tap\d|vpn|zerotier|tailscale|hamachi|npcap|loopback|bluetooth)/i;
const PHYSICAL_INTERFACE = /(wi-?fi|wlan|wireless|ethernet|eth\d+|en\d+|lan)/i;

function scoreAddress(interfaceName, address) {
    let score = 0;

    if (/^192\.168\./.test(address)) score += 50;
    else if (/^10\./.test(address)) score += 40;
    else if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(address)) score += 30;
    else if (/^169\.254\./.test(address)) score -= 100; // link-local, not routable
    else score += 10;

    if (VIRTUAL_INTERFACE.test(interfaceName)) score -= 60;
    if (PHYSICAL_INTERFACE.test(interfaceName)) score += 10;
    // Windows Internet Connection Sharing / mobile hotspot defaults.
    if (/^192\.168\.137\./.test(address)) score += 5;

    return score;
}

function getLanAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];

    for (const [name, entries] of Object.entries(interfaces)) {
        for (const entry of entries || []) {
            if (entry.internal) continue;
            if (entry.family !== 'IPv4' && entry.family !== 4) continue;
            addresses.push({
                interface: name,
                address: entry.address,
                score: scoreAddress(name, entry.address),
            });
        }
    }

    return addresses.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
}

function getLanIp() {
    const addresses = getLanAddresses();
    return addresses.length ? addresses[0].address : 'localhost';
}

function activePort() {
    if (server) {
        const address = server.address();
        if (address && typeof address === 'object' && address.port) return address.port;
    }
    return config.port;
}

// --- Middleware ---

app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    // The client only loads same-origin assets. Vendored marked/DOMPurify and
    // the removal of inline handlers make a strict script policy possible.
    // Inline styles remain because index.html uses style attributes.
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ].join('; '));
    next();
});

app.use(express.json({ limit: config.maxBodySize }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Authentication ---

const loginAttempts = new Map();

function loginKey(req) {
    return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function rateLimitLogin(req, res, next) {
    const key = loginKey(req);
    const now = Date.now();
    const entry = loginAttempts.get(key);

    if (entry && now < entry.resetAt && entry.count >= config.loginMaxAttempts) {
        res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
        return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }

    if (!entry || now >= entry.resetAt) {
        loginAttempts.set(key, { count: 0, resetAt: now + config.loginWindowMs });
    }
    // Prevent unbounded growth from distributed clients.
    if (loginAttempts.size > 10000) {
        for (const [ip, value] of loginAttempts) {
            if (now >= value.resetAt) loginAttempts.delete(ip);
        }
    }
    return next();
}

function recordLoginFailure(req) {
    const entry = loginAttempts.get(loginKey(req));
    if (entry) entry.count += 1;
}

function authMiddleware(req, res, next) {
    if (!config.appPassword) return next();
    const provided = req.get('x-app-password');
    if (typeof provided === 'string' && safeEqual(provided, config.appPassword)) return next();
    return res.status(401).json({ error: 'Unauthorized. Password required.' });
}

app.post('/api/login', rateLimitLogin, (req, res) => {
    const password = req.body && req.body.password;
    if (typeof password !== 'string') {
        return res.status(400).json({ error: 'Password is required.' });
    }
    if (!config.appPassword || safeEqual(password, config.appPassword)) {
        loginAttempts.delete(loginKey(req));
        return res.json({ success: true });
    }
    recordLoginFailure(req);
    return res.status(401).json({ error: 'Invalid password' });
});

// Status and health are intentionally public and expose no secrets.
app.get('/api/status', (req, res) => {
    detectOllama().catch(() => {});
    const connected = mode === 'local' || (mode === 'cloud' && Boolean(config.cloudApiKey));
    const addresses = getLanAddresses();
    res.json({
        mode,
        connected,
        lanIp: addresses.length ? addresses[0].address : 'localhost',
        lanIps: addresses.slice(0, 5).map((entry) => entry.address),
        port: activePort(),
        authRequired: Boolean(config.appPassword),
        cloudAvailable: Boolean(config.cloudApiKey),
        version: VERSION,
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: VERSION, mode, uptime: Math.round(process.uptime()) });
});

// Everything below requires authentication when APP_PASSWORD is configured.
app.use('/api', (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (!origin) return next();
    try {
        if (new URL(origin).host !== req.get('host')) {
            return res.status(403).json({ error: 'Cross-origin request blocked.' });
        }
    } catch (e) {
        return res.status(403).json({ error: 'Invalid Origin header.' });
    }
    return next();
});

app.use('/api', authMiddleware);

app.get('/api/auth/verify', (req, res) => {
    res.json({ ok: true });
});

// --- Models ---

app.get('/api/models', asyncHandler(async (req, res) => {
    if (mode === 'detecting') await detectOllama();
    const cached = loadModelsFromCache();

    if (mode === 'local') {
        try {
            const data = await fetchOllamaTags(`${config.localOllamaUrl}/api/tags`);
            const models = Array.isArray(data.models) ? data.models : [];
            await saveModelsToCache(models);
            return res.json({ models, source: 'local', stale: false });
        } catch (error) {
            console.error('[models] Local fetch failed:', error.message);
            if (cached.models.length) return res.json({ ...cached, source: 'cache', stale: true });
            return res.status(502).json({ error: 'Failed to list local models.' });
        }
    }

    if (mode === 'cloud' && config.cloudApiKey) {
        try {
            const data = await fetchOllamaTags(`${config.cloudOllamaUrl}/tags`, true);
            const models = Array.isArray(data.models) ? data.models : [];
            await saveModelsToCache(models);
            return res.json({ models, source: 'cloud', stale: false });
        } catch (error) {
            console.error('[models] Cloud fetch failed:', error.message);
        }
    }

    return res.json({ ...cached, source: 'cache', stale: true });
}));

// --- Chat history ---

app.get('/api/chats', asyncHandler(async (req, res) => {
    const chats = await db.listChats();
    res.json(chats);
}));

app.post('/api/chats', asyncHandler(async (req, res) => {
    const { title, model } = req.body || {};
    const chat = await db.createChat({ title, model });
    res.json(chat);
}));

app.get('/api/chats/:id', asyncHandler(async (req, res) => {
    if (!/^[0-9]+$/.test(req.params.id)) {
        throw new HttpError(400, 'Chat id must be a positive integer.');
    }
    const chat = await db.getChat(Number(req.params.id));
    if (!chat) throw new HttpError(404, 'Chat not found');
    const messages = await db.getMessages(chat.id);
    res.json({ ...chat, messages });
}));

app.delete('/api/chats/:id', asyncHandler(async (req, res) => {
    if (!/^[0-9]+$/.test(req.params.id)) {
        throw new HttpError(400, 'Chat id must be a positive integer.');
    }
    const result = await db.deleteChat(Number(req.params.id));
    if (!result.changes) throw new HttpError(404, 'Chat not found');
    res.json({ success: true });
}));

// --- Streaming chat ---

function startSse(res) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    if (res.socket) res.socket.setNoDelay(true);
}

function writeSse(res, payload) {
    if (res.writableEnded || res.destroyed) return false;
    return res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

app.post('/api/chat', asyncHandler(async (req, res) => {
    const validationError = validateChatPayload(req.body);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    const { messages, model, options, think, clientMessageId } = req.body;
    const rawChatId = req.body.chatId;
    const chatId = rawChatId === undefined || rawChatId === null || rawChatId === ''
        ? null
        : Number(rawChatId);

    if (mode === 'detecting') await detectOllama();
    if (mode === 'none') {
        return res.status(503).json({ error: 'No Ollama connection. Start Ollama or configure OLLAMA_API_KEY.' });
    }
    if (mode === 'cloud' && !config.cloudApiKey) {
        return res.status(503).json({ error: 'Cloud mode requires OLLAMA_API_KEY.' });
    }
    if (chatId) {
        const existing = await db.getChat(chatId);
        if (!existing) return res.status(404).json({ error: 'Chat not found' });
    }

    const targetUrl = mode === 'local'
        ? `${config.localOllamaUrl}/api/chat`
        : `${config.cloudOllamaUrl}/chat`;
    const headers = { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' };
    if (mode === 'cloud') headers.Authorization = `Bearer ${config.cloudApiKey}`;

    const body = {
        model,
        messages,
        stream: true,
        ...(sanitizeOptions(options) ? { options: sanitizeOptions(options) } : {}),
        ...(think && think !== 'none' ? { think } : {}),
    };

    const upstream = new AbortController();
    const timeout = setTimeout(() => upstream.abort(), config.requestTimeoutMs);
    const onClientClose = () => {
        if (!res.writableEnded) upstream.abort();
    };
    res.on('close', onClientClose);

    let response;
    try {
        response = await fetch(targetUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: upstream.signal,
        });
    } catch (error) {
        clearTimeout(timeout);
        res.off('close', onClientClose);
        if (error.name === 'AbortError') {
            return res.status(504).json({ error: 'Ollama request timed out.' });
        }
        return res.status(502).json({ error: `Could not reach Ollama: ${error.message}` });
    }

    if (!response.ok) {
        const detail = await readResponseText(response);
        clearTimeout(timeout);
        res.off('close', onClientClose);
        console.error('[chat] Upstream error:', response.status, detail.slice(0, 300));
        return res.status(502).json({ error: upstreamError(response.status, detail) });
    }

    // The upstream accepted the request; only now start the SSE response and
    // persist the chat. Failed requests no longer leave empty chats behind.
    startSse(res);

    let persistedChatId = chatId;
    if (!persistedChatId) {
        const firstUser = messages.find((message) => message.role === 'user');
        try {
            const chat = await db.createChat({ title: makeTitle(firstUser ? firstUser.content : 'New Chat'), model });
            persistedChatId = chat.id;
        } catch (error) {
            console.error('[chat] Failed to create chat:', error.message);
            clearTimeout(timeout);
            res.off('close', onClientClose);
            writeSse(res, { error: 'Could not create the chat. Check the server logs.' });
            if (!res.writableEnded && !res.destroyed) res.end();
            return;
        }
        writeSse(res, { type: 'chat_created', chatId: persistedChatId });
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'user') {
        try {
            await db.addMessage({
                chatId: persistedChatId,
                role: 'user',
                content: lastMessage.content,
                clientMessageId: clientMessageId || null,
            });
            await db.touchChat(persistedChatId, model);
        } catch (error) {
            console.error('[chat] Failed to save user message:', error.message);
            writeSse(res, { warning: 'Your message could not be saved to history.' });
        }
    }

    const heartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n');
    }, 15000);
    if (heartbeat.unref) heartbeat.unref();

    const decoder = new TextDecoder();
    let buffer = '';
    let assistantContent = '';
    let assistantThinking = '';
    let persistedAssistant = false;

    const persistAssistant = async () => {
        if (persistedAssistant || !persistedChatId) return;
        if (!assistantContent && !assistantThinking) return;
        persistedAssistant = true;
        try {
            await db.addMessage({
                chatId: persistedChatId,
                role: 'assistant',
                content: assistantContent,
                thinking: assistantThinking || null,
            });
            await db.touchChat(persistedChatId, model);
        } catch (error) {
            console.error('[chat] Failed to save assistant message:', error.message);
        }
    };

    const ingestLine = async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let json;
        try {
            json = JSON.parse(trimmed);
        } catch (e) {
            return; // Ignore non-JSON noise rather than corrupting the stream.
        }
        writeSse(res, json);
        if (json.message && json.message.content) assistantContent += json.message.content;
        if (json.message && json.message.thinking) assistantThinking += json.message.thinking;
        if (json.done) await persistAssistant();
    };

    try {
        for await (const chunk of response.body) {
            buffer += decoder.decode(chunk, { stream: true });
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);
                await ingestLine(line);
            }
        }
        buffer += decoder.decode();
        await ingestLine(buffer);
        await persistAssistant();
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('[chat] Stream aborted', res.destroyed ? '(client disconnected)' : '(timeout)');
            await persistAssistant();
        } else {
            console.error('[chat] Stream error:', error.message);
            writeSse(res, { error: error.message });
        }
    } finally {
        clearInterval(heartbeat);
        clearTimeout(timeout);
        res.off('close', onClientClose);
        if (!res.writableEnded && !res.destroyed) res.end();
    }
}));

// --- Fallbacks ---

app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) {
        console.error('[ERROR]', req.method, req.originalUrl, error.message);
    }
    if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
    }
    // Never leak stack traces or internal paths to clients.
    res.status(status).json({ error: status >= 500 ? 'Internal server error.' : error.message });
});

// --- Lifecycle ---

function start() {
    return new Promise((resolve, reject) => {
        server = http.createServer(app);
        const onError = (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`[FATAL] Port ${config.port} is already in use. Set PORT in .env to a free port.`);
            } else {
                console.error('[FATAL] Server error:', error.message);
            }
            reject(error);
        };
        server.once('error', onError);
        server.listen(config.port, config.host, () => {
            server.off('error', onError);
            const port = activePort();
            const addresses = getLanAddresses();
            const primary = addresses.length ? addresses[0] : { address: 'localhost', interface: 'loopback' };
            const url = `http://${primary.address}:${port}`;

            console.log('\n=======================================');
            console.log('🚀 Ollama Phone Chat Bridge Running!');
            if (addresses.length) {
                console.log(`📱 Connect your phone to: ${url}`);
                console.log(`   Interface: ${primary.interface}`);
                if (addresses.length > 1) {
                    console.log('   Other addresses:');
                    for (const entry of addresses.slice(1, 5)) {
                        console.log(`     http://${entry.address}:${port}  (${entry.interface})`);
                    }
                }
            } else {
                console.log('⚠️  No LAN address found. Connect this machine to Wi-Fi/Ethernet.');
            }
            console.log(`🖥️  This machine: http://localhost:${port}`);
            if (!config.appPassword) {
                console.log('⚠️  No APP_PASSWORD set: anyone on your LAN can read chats and use the API key.');
            }
            console.log('=======================================\n');
            if (addresses.length) qrcode.generate(url, { small: true });
            resolve(server);
        });
    });
}

async function stop() {
    if (healthTimer) {
        clearInterval(healthTimer);
        healthTimer = null;
    }
    if (server) {
        const activeServer = server;
        await new Promise((resolve) => {
            const force = setTimeout(() => {
                if (activeServer.closeAllConnections) activeServer.closeAllConnections();
                resolve();
            }, 2000);
            if (force.unref) force.unref();
            activeServer.close(() => {
                clearTimeout(force);
                resolve();
            });
            // Release idle keep-alive sockets (mobile browsers hold them open).
            if (activeServer.closeIdleConnections) activeServer.closeIdleConnections();
        });
        server = null;
    }
    try {
        await db.close();
    } catch (e) {
        // Already closed.
    }
}

async function main() {
    await db.initDb();
    await detectOllama({ force: true });
    startModeWatcher();
    await start();

    const shutdown = async (signal) => {
        console.log(`\n[INFO] ${signal} received, shutting down...`);
        try {
            await stop();
        } finally {
            process.exit(0);
        }
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
    main().catch((error) => {
        console.error('[FATAL] Failed to start:', error);
        process.exit(1);
    });
}

module.exports = {
    app,
    start,
    stop,
    main,
    detectOllama,
    validateChatPayload,
    getLanIp,
    getLanAddresses,
    get mode() { return mode; },
    get server() { return server; },
};
