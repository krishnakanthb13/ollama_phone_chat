'use strict';

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load .env so db.js can also be used standalone (tests, scripts) without
// silently falling back to a different encryption key than the server.
require('dotenv').config();

// --- Encryption ---
// New records use AES-256-GCM (authenticated). Legacy AES-256-CBC records are
// still readable so existing installations keep their history.
const GCM_PREFIX = 'ag1:';
const GCM_RE = /^ag1:([0-9a-f]{24}):([0-9a-f]{32}):([0-9a-f]*)$/i;
const LEGACY_RE = /^ag:([0-9a-f]{32}):([0-9a-f]+)$/i;

const APP_PASSWORD = process.env.APP_PASSWORD || '';

const dataDir = process.env.DB_PATH
    ? path.dirname(path.resolve(process.env.DB_PATH))
    : path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(dataDir, 'chats.db');
const saltFile = path.join(dataDir, '.key_salt');

let encryptionEnabled = false;
let primaryKey = null;
let legacyKey = null;
const warned = new Set();

function warnOnce(message) {
    if (warned.has(message)) return;
    warned.add(message);
    console.warn('[DB]', message);
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest();
}

function loadKeyMaterial() {
    if (!APP_PASSWORD) {
        // No password means no at-rest encryption. This matches the documented
        // behaviour and avoids the former invalid 31-byte fallback key, which
        // made every message insert throw.
        encryptionEnabled = false;
        return;
    }

    encryptionEnabled = true;
    // Legacy records were encrypted with SHA-256(password) as the raw key.
    legacyKey = sha256(APP_PASSWORD);

    let salt;
    try {
        const stored = fs.readFileSync(saltFile, 'utf8').trim();
        if (/^[0-9a-f]{64}$/i.test(stored)) salt = Buffer.from(stored, 'hex');
    } catch (e) {
        // Generated below on first run.
    }

    if (!salt) {
        salt = crypto.randomBytes(32);
        fs.writeFileSync(saltFile, salt.toString('hex'), { mode: 0o600 });
        try { fs.chmodSync(saltFile, 0o600); } catch (e) { /* Windows best effort */ }
    }

    primaryKey = crypto.scryptSync(APP_PASSWORD, salt, 32);
}

loadKeyMaterial();

function encrypt(text) {
    if (!text || typeof text !== 'string') return text;
    if (!encryptionEnabled) return text;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', primaryKey, iv);
    const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${GCM_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decrypt(value) {
    if (typeof value !== 'string') return value;

    const gcm = GCM_RE.exec(value);
    if (gcm) {
        if (!primaryKey) return '[Encrypted content: APP_PASSWORD required]';
        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', primaryKey, Buffer.from(gcm[1], 'hex'));
            decipher.setAuthTag(Buffer.from(gcm[2], 'hex'));
            return Buffer.concat([
                decipher.update(Buffer.from(gcm[3], 'hex')),
                decipher.final(),
            ]).toString('utf8');
        } catch (e) {
            warnOnce('Unable to decrypt a message. The APP_PASSWORD may not match this database.');
            return '[Encrypted content could not be decrypted]';
        }
    }

    const legacy = LEGACY_RE.exec(value);
    if (legacy) {
        if (!legacyKey) return '[Encrypted content: APP_PASSWORD required]';
        try {
            const decipher = crypto.createDecipheriv('aes-256-cbc', legacyKey, Buffer.from(legacy[1], 'hex'));
            return Buffer.concat([
                decipher.update(Buffer.from(legacy[2], 'hex')),
                decipher.final(),
            ]).toString('utf8');
        } catch (e) {
            warnOnce('Unable to decrypt a legacy message. The APP_PASSWORD may have changed.');
            return '[Encrypted content could not be decrypted]';
        }
    }

    // Not an envelope. This deliberately preserves plaintext rows (including
    // user messages that happen to start with "ag:"), which previously were
    // mistaken for ciphertext and permanently mangled.
    return value;
}

// --- Database connection ---

const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function exec(sql) {
    return new Promise((resolve, reject) => {
        db.exec(sql, (err) => (err ? reject(err) : resolve()));
    });
}

function mapMessage(row) {
    if (!row) return row;
    return {
        ...row,
        content: decrypt(row.content),
        thinking: row.thinking ? decrypt(row.thinking) : row.thinking,
    };
}

function mapChat(row) {
    if (!row) return row;
    return { ...row, title: decrypt(row.title) };
}

let initPromise = null;

async function initDb() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        // WAL keeps reads responsive while a stream is being persisted and
        // `busy_timeout` avoids spurious SQLITE_BUSY errors.
        await exec('PRAGMA journal_mode = WAL;');
        await exec('PRAGMA synchronous = NORMAL;');
        await exec('PRAGMA busy_timeout = 5000;');
        // SQLite does not enforce foreign keys unless asked, per connection.
        await exec('PRAGMA foreign_keys = ON;');

        await exec(`
            CREATE TABLE IF NOT EXISTS chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                model TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                thinking TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
            );
        `);

        await exec(`
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);

        // Migration: idempotency key so retried sends do not duplicate messages.
        const columns = await all('PRAGMA table_info(messages)');
        if (!columns.some((column) => column.name === 'client_message_id')) {
            await exec('ALTER TABLE messages ADD COLUMN client_message_id TEXT;');
        }

        await exec('CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at, id);');
        await exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client
                    ON messages(chat_id, client_message_id)
                    WHERE client_message_id IS NOT NULL;`);

        await verifyKeyMaterial();

        console.log('Database initialized at:', dbPath);
        return dbPath;
    })();

    return initPromise;
}

async function verifyKeyMaterial() {
    const row = await get('SELECT value FROM meta WHERE key = ?', ['encryption_check']);

    if (!encryptionEnabled) {
        if (row) {
            warnOnce('Encrypted history detected but APP_PASSWORD is not set. Set APP_PASSWORD to read it.');
        }
        return;
    }

    if (!row) {
        await run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
            'encryption_check',
            encrypt('ok'),
        ]);
        return;
    }

    if (decrypt(row.value) !== 'ok') {
        console.error('[DB] APP_PASSWORD does not match this database. Existing history cannot be decrypted.');
    }
}

// --- Repository API (the only place that knows about encryption) ---

async function createChat({ title = 'New Chat', model = 'unknown' } = {}) {
    const safeTitle = typeof title === 'string' && title.trim() ? title.trim() : 'New Chat';
    const safeModel = typeof model === 'string' && model.trim() ? model.trim() : 'unknown';
    const result = await run('INSERT INTO chats (title, model) VALUES (?, ?)', [
        encrypt(safeTitle),
        safeModel,
    ]);
    return getChat(result.id);
}

async function listChats() {
    const rows = await all('SELECT * FROM chats ORDER BY updated_at DESC, id DESC');
    return rows.map(mapChat);
}

async function getChat(id) {
    const row = await get('SELECT * FROM chats WHERE id = ?', [id]);
    return mapChat(row);
}

async function getMessages(chatId) {
    const rows = await all(
        'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC, id ASC',
        [chatId]
    );
    return rows.map(mapMessage);
}

async function addMessage({ chatId, role, content, thinking = null, clientMessageId = null }) {
    const result = await run(
        `INSERT OR IGNORE INTO messages (chat_id, role, content, thinking, client_message_id)
         VALUES (?, ?, ?, ?, ?)`,
        [chatId, role, encrypt(content), thinking ? encrypt(thinking) : thinking, clientMessageId]
    );

    if (result.changes === 0 && clientMessageId) {
        const existing = await get(
            'SELECT * FROM messages WHERE chat_id = ? AND client_message_id = ?',
            [chatId, clientMessageId]
        );
        return existing ? mapMessage(existing) : null;
    }

    return result;
}

async function touchChat(id, model) {
    return run(
        'UPDATE chats SET updated_at = CURRENT_TIMESTAMP, model = COALESCE(?, model) WHERE id = ?',
        [model || null, id]
    );
}

async function deleteChat(id) {
    return run('DELETE FROM chats WHERE id = ?', [id]);
}

function close() {
    return new Promise((resolve, reject) => {
        db.close((err) => (err ? reject(err) : resolve()));
    });
}

module.exports = {
    initDb,
    createChat,
    listChats,
    getChat,
    getMessages,
    addMessage,
    touchChat,
    deleteChat,
    close,
    // Low-level helpers intentionally bypass encryption; use the repository
    // functions above for chat data.
    run,
    get,
    all,
    encrypt,
    decrypt,
    get encryptionEnabled() { return encryptionEnabled; },
    get path() { return dbPath; },
};
