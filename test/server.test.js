'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-server-test-'));
const AUTH = { 'x-app-password': 'testpass' };

let mock;
let server;
let base;
let serverApi;
let sentChats = 0;

const mockServer = http.createServer((req, res) => {
  if (req.url === '/api/tags') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ models: [{ name: 'llama3:8b' }, { name: 'glm-4.7:cloud' }] }));
  }

  if (req.url === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      if (parsed.model === 'fail-model') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'mock upstream exploded' }));
      }
      sentChats += 1;
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(JSON.stringify({ message: { role: 'assistant', content: 'Hello ' }, done: false }) + '\n');
      setTimeout(() => {
        res.write(JSON.stringify({ message: { role: 'assistant', content: 'from mock ✅' }, done: false }) + '\n');
        res.write(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n');
        res.end();
      }, 30);
    });
    return;
  }

  res.writeHead(404).end();
});

test.before(async () => {
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  mock = mockServer.address();

  process.env.MODE = 'local';
  process.env.PORT = '0';
  process.env.APP_PASSWORD = 'testpass';
  process.env.OLLAMA_HOST = `http://127.0.0.1:${mock.port}`;
  process.env.DB_PATH = path.join(TMP, 'chats.db');
  process.env.MODELS_CACHE = path.join(TMP, 'models_cache.json');
  process.env.LOGIN_MAX_ATTEMPTS = '5';
  process.env.LOGIN_WINDOW_MS = '60000';

  const db = require('../db');
  await db.initDb();

  serverApi = require('../server');
  server = await serverApi.start();
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  try {
    await serverApi.stop();
  } catch (error) {
    // Already stopped.
  }
  await new Promise((resolve) => mockServer.close(resolve));
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function sendChat(body, headers = AUTH) {
  return fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('reports status, LAN candidates, and the package version', async () => {
  const response = await fetch(`${base}/api/status`);
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.mode, 'local');
  assert.equal(status.connected, true);
  assert.equal(status.authRequired, true);
  assert.equal(status.version, require('../package.json').version);
  assert.equal(Number(status.port), server.address().port, 'status must report the bound port');
  assert.ok(Array.isArray(status.lanIps));
  assert.equal(status.lanIp, status.lanIps[0]);

  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.status, 'ok');
});

test('serves security headers and offline assets', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  const csp = page.headers.get('content-security-policy');
  assert.ok(csp.includes("script-src 'self'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));

  const html = await page.text();
  assert.ok(!html.includes('cdn.jsdelivr.net'));
  assert.ok(!html.includes('cdnjs.cloudflare.com'));
  assert.ok(!/\son\w+\s*=/.test(html), 'inline event handlers are not allowed under the CSP');

  assert.equal((await fetch(`${base}/vendor/marked.umd.js`)).status, 200);
  assert.equal((await fetch(`${base}/vendor/purify.min.js`)).status, 200);
});

test('requires authentication for API routes', async () => {
  assert.equal((await fetch(`${base}/api/chats`)).status, 401);
  assert.equal((await fetch(`${base}/api/auth/verify`, { headers: AUTH })).status, 200);
});

test('validates chat payloads without throwing', () => {
  const { validateChatPayload } = serverApi;
  assert.ok(validateChatPayload(null));
  assert.ok(validateChatPayload({ model: 'm', messages: [] }));
  assert.ok(validateChatPayload({ model: '', messages: [{ role: 'user', content: 'x' }] }));
  assert.ok(validateChatPayload({ model: 'm', messages: [{ role: 'wizard', content: 'x' }] }));
  assert.ok(validateChatPayload({ model: 'm', messages: [{ role: 'user', content: 1 }] }));
  assert.ok(validateChatPayload({
    model: 'm',
    messages: [{ role: 'user', content: 'x' }],
    chatId: -3,
  }));
  assert.ok(validateChatPayload({
    model: 'm',
    messages: [{ role: 'user', content: 'x' }],
    clientMessageId: 'bad id!',
  }));
  assert.equal(validateChatPayload({
    model: 'llama3:8b',
    messages: [{ role: 'user', content: 'hello' }],
    chatId: 1,
    clientMessageId: 'retry_1',
    think: 'medium',
    options: { temperature: 0.2, web_search: true },
  }), null);
});

test('lists models and streams a persisted chat', async () => {
  const models = await (await fetch(`${base}/api/models`, { headers: AUTH })).json();
  assert.equal(models.source, 'local');
  assert.ok(models.models.some((model) => model.name === 'llama3:8b'));
  const byName = Object.fromEntries(models.models.map((model) => [model.name, model]));
  assert.equal(byName['llama3:8b'].cloud, false, 'local models must not be tagged as cloud');
  assert.equal(byName['glm-4.7:cloud'].cloud, true,
    'local entries with a :cloud suffix are proxied cloud models');

  const cache = JSON.parse(fs.readFileSync(process.env.MODELS_CACHE, 'utf8'));
  assert.equal(cache.source, 'local');

  const response = await sendChat({
    model: 'llama3:8b',
    messages: [{ role: 'user', content: 'hello from tests' }],
  });
  assert.equal(response.status, 200);
  assert.ok((response.headers.get('content-type') || '').includes('text/event-stream'));

  const stream = await response.text();
  assert.ok(stream.includes('from mock ✅'));
  const match = /"chatId":(\d+)/.exec(stream);
  assert.ok(match, 'chat_created event missing');

  const detail = await (await fetch(`${base}/api/chats/${match[1]}`, { headers: AUTH })).json();
  assert.equal(detail.messages.length, 2);
  assert.equal(detail.messages[0].role, 'user');
  assert.equal(detail.messages[1].role, 'assistant');
  assert.ok(detail.messages[1].content.includes('from mock'));
});

test('does not duplicate user messages on retry', async () => {
  const clientMessageId = 'retry_1';
  const first = await sendChat({
    model: 'llama3:8b',
    clientMessageId,
    messages: [{ role: 'user', content: 'retry me' }],
  });
  const firstStream = await first.text();
  const chatId = /"chatId":(\d+)/.exec(firstStream)[1];

  const second = await sendChat({
    chatId: Number(chatId),
    model: 'llama3:8b',
    clientMessageId,
    messages: [{ role: 'user', content: 'retry me' }],
  });
  await second.text();

  const detail = await (await fetch(`${base}/api/chats/${chatId}`, { headers: AUTH })).json();
  const userMessages = detail.messages.filter((message) => message.role === 'user');
  assert.equal(userMessages.length, 1);
});

test('upstream failure returns 502 and leaves no empty chat', async () => {
  const before = (await (await fetch(`${base}/api/chats`, { headers: AUTH })).json()).length;
  const response = await sendChat({
    model: 'fail-model',
    messages: [{ role: 'user', content: 'this will fail' }],
  });
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Ollama/);

  const after = (await (await fetch(`${base}/api/chats`, { headers: AUTH })).json()).length;
  assert.equal(after, before);
});

test('returns JSON errors for malformed or unknown requests', async () => {
  const malformed = await sendChat('{"model":');
  assert.equal(malformed.status, 400);
  assert.ok((await malformed.json()).error);

  const missingChat = await sendChat({
    chatId: 999999,
    model: 'llama3:8b',
    messages: [{ role: 'user', content: 'x' }],
  });
  assert.equal(missingChat.status, 404);

  const unknown = await fetch(`${base}/api/nope`, { headers: AUTH });
  assert.equal(unknown.status, 404);
  assert.ok((await unknown.json()).error);

  // The process must still be serving after bad input.
  assert.equal((await fetch(`${base}/api/status`)).status, 200);
});

test('rate-limits repeated login failures', async () => {
  const good = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'testpass' }),
  });
  assert.equal(good.status, 200);

  let limited = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    if (response.status === 429) {
      limited = response;
      break;
    }
    assert.equal(response.status, 401);
  }

  assert.ok(limited, 'login attempts were never rate limited');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.ok(sentChats >= 3, 'mock upstream was not exercised');
});
