const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// --- Encryption Configuration ---
const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.APP_PASSWORD
    ? crypto.createHash('sha256').update(String(process.env.APP_PASSWORD)).digest()
    : Buffer.from('da7a6a7c8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5', 'hex'); // Fallback (Static)
const PREFIX = 'ag:'; // Encryption identifier

function encrypt(text) {
    if (!text || typeof text !== 'string') return text;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return PREFIX + iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    if (!text || typeof text !== 'string' || !text.startsWith(PREFIX)) return text;
    try {
        const parts = text.substring(PREFIX.length).split(':');
        const iv = Buffer.from(parts.shift(), 'hex');
        const encryptedText = Buffer.from(parts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error('[DB] Decryption failed. Content might be corrupted or key changed.');
        return '[Encrypted Content - Decryption Error]';
    }
}

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'chats.db');
const db = new sqlite3.Database(dbPath);

// Promisify wrapper
const dbAsync = {
    run: (sql, params = []) => {
        // Automatically encrypt outgoing messages
        const lowerSql = sql.toLowerCase();
        if (lowerSql.includes('insert into messages') || lowerSql.includes('update messages')) {
            // content is usually at index 2 (insert) or 0 (update), but we'll be safer
            // For this app, we know the order: [chat_id, role, content, thinking] or [chat_id, role, content]
            // We'll iterate and encrypt anything that looks like content if we're in the right table call
            if (params[2] && typeof params[2] === 'string' && !params[2].startsWith(PREFIX)) params[2] = encrypt(params[2]);
            if (params[3] && typeof params[3] === 'string' && !params[3].startsWith(PREFIX)) params[3] = encrypt(params[3]);
        }
        return new Promise((resolve, reject) => {
            db.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    },
    get: (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else {
                    if (row) {
                        if (row.content) row.content = decrypt(row.content);
                        if (row.thinking) row.thinking = decrypt(row.thinking);
                    }
                    resolve(row);
                }
            });
        });
    },
    all: (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else {
                    if (rows) {
                        rows.forEach(row => {
                            if (row.content) row.content = decrypt(row.content);
                            if (row.thinking) row.thinking = decrypt(row.thinking);
                        });
                    }
                    resolve(rows);
                }
            });
        });
    },
    close: () => {
        return new Promise((resolve, reject) => {
            db.close((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
};

// Initialize tables
async function initDb() {
    try {
        await dbAsync.run(`
      CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

        await dbAsync.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        thinking TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
      )
    `);
        console.log('Database initialized at:', dbPath);
    } catch (err) {
        console.error('Failed to initialize database:', err);
    }
}

initDb();

module.exports = dbAsync;
