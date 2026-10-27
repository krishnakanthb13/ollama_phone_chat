'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-db-test-'));
process.env.APP_PASSWORD = 'correct-password';
process.env.DB_PATH = path.join(TMP, 'chats.db');

const db = require('../db');

let firstChatId;

test.before(async () => {
  await db.initDb();
});

test.after(async () => {
  try {
    await db.close();
  } catch (error) {
    // The wrong-password test closes the connection itself.
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('enables foreign keys, WAL, and the migration columns', async () => {
  const foreignKeys = await db.get('PRAGMA foreign_keys');
  const journal = await db.get('PRAGMA journal_mode');
  assert.equal(foreignKeys.foreign_keys, 1);
  assert.equal(String(journal.journal_mode).toLowerCase(), 'wal');

  const columns = (await db.all('PRAGMA table_info(messages)')).map((column) => column.name);
  assert.ok(columns.includes('client_message_id'));
});

test('encrypts titles and never mangles payloads that start with "ag:"', async () => {
  const chat = await db.createChat({ title: 'ag:tricky title', model: null });
  firstChatId = chat.id;

  assert.equal(chat.title, 'ag:tricky title');
  assert.equal(chat.model, 'unknown');

  const raw = await db.get('SELECT title FROM chats WHERE id = ?', [chat.id]);
  assert.ok(raw.title.startsWith('ag1:'), 'new titles must use the GCM envelope');
  assert.ok(!raw.title.includes('tricky title'), 'title must not be stored in plaintext');
});

test('encrypts message content and thinking, and decrypts both', async () => {
  const message = await db.addMessage({
    chatId: firstChatId,
    role: 'user',
    content: 'ag:hello world',
    thinking: 'thinking ag:x',
    clientMessageId: 'client-1',
  });
  assert.ok(message.id);

  const raw = await db.get('SELECT content, thinking FROM messages WHERE id = ?', [message.id]);
  assert.ok(raw.content.startsWith('ag1:'));
  assert.ok(raw.thinking.startsWith('ag1:'));

  const rows = await db.getMessages(firstChatId);
  assert.equal(rows[0].content, 'ag:hello world');
  assert.equal(rows[0].thinking, 'thinking ag:x');
});

test('deduplicates retries with the same clientMessageId', async () => {
  await db.addMessage({
    chatId: firstChatId,
    role: 'user',
    content: 'ag:hello world',
    clientMessageId: 'client-1',
  });
  const count = await db.get('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?', [firstChatId]);
  assert.equal(count.n, 1);

  const existing = await db.addMessage({
    chatId: firstChatId,
    role: 'user',
    content: 'different body on retry',
    clientMessageId: 'client-1',
  });
  assert.equal(existing.content, 'ag:hello world');
});

test('reads legacy AES-256-CBC rows written by v0.0.4', async () => {
  const legacyKey = crypto.createHash('sha256').update('correct-password').digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', legacyKey, iv);
  const ciphertext = Buffer.concat([cipher.update('legacy content', 'utf8'), cipher.final()]);
  const legacy = `ag:${iv.toString('hex')}:${ciphertext.toString('hex')}`;

  await db.run(
    'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
    [firstChatId, 'assistant', legacy]
  );

  const rows = await db.getMessages(firstChatId);
  assert.ok(rows.some((row) => row.content === 'legacy content'));
});

test('cascades message deletion when a chat is deleted', async () => {
  const chat = await db.createChat({ title: 'temporary', model: 'llama3:8b' });
  await db.addMessage({ chatId: chat.id, role: 'user', content: 'bye' });

  const before = await db.get('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?', [chat.id]);
  assert.equal(before.n, 1);

  await db.deleteChat(chat.id);
  const after = await db.get('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?', [chat.id]);
  assert.equal(after.n, 0, 'foreign_keys must cascade deletes');

  assert.equal(await db.getChat(chat.id), undefined);
});

test('a wrong password produces clear markers instead of silent corruption', async () => {
  await db.close();

  const script = `
    const db = require(${JSON.stringify(path.join(__dirname, '..', 'db.js'))});
    (async () => {
      await db.initDb();
      const chat = await db.getChat(Number(process.argv[1]));
      const messages = await db.getMessages(Number(process.argv[1]));
      console.log(JSON.stringify({ title: chat.title, contents: messages.map((m) => m.content) }));
      await db.close();
    })().catch((error) => { console.error(error); process.exit(1); });
  `;

  const result = spawnSync(process.execPath, ['-e', script, String(firstChatId)], {
    env: { ...process.env, APP_PASSWORD: 'wrong-password' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.ok(output.title.includes('could not be decrypted'), 'title marker missing');
  assert.ok(
    output.contents.some((content) => content.includes('could not be decrypted')),
    'message marker missing'
  );
  assert.ok(!output.contents.includes('ag:hello world'), 'wrong key must not reveal plaintext');
});
