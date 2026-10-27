'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-db-plain-'));
process.env.APP_PASSWORD = '';
process.env.DB_PATH = path.join(TMP, 'chats.db');

const db = require('../db');

test.before(async () => {
  await db.initDb();
});

test.after(async () => {
  try {
    await db.close();
  } catch (error) {
    // Already closed.
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('stores plaintext when APP_PASSWORD is unset', async () => {
  assert.equal(db.encryptionEnabled, false);

  const chat = await db.createChat({ title: 'plain title', model: 'llama3:8b' });
  await db.addMessage({ chatId: chat.id, role: 'user', content: 'ag:hello world' });

  const rawChat = await db.get('SELECT title FROM chats WHERE id = ?', [chat.id]);
  assert.equal(rawChat.title, 'plain title');

  const rawMessage = await db.get('SELECT content FROM messages WHERE chat_id = ?', [chat.id]);
  assert.equal(rawMessage.content, 'ag:hello world', 'plaintext rows must not gain an envelope');

  const messages = await db.getMessages(chat.id);
  assert.equal(messages[0].content, 'ag:hello world');
});
