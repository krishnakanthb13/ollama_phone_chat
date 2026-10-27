'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const publicDir = path.join(ROOT, 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const markedSource = fs.readFileSync(path.join(publicDir, 'vendor', 'marked.umd.js'), 'utf8');
const purifySource = fs.readFileSync(path.join(publicDir, 'vendor', 'purify.min.js'), 'utf8');
const encoder = new TextEncoder();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, message, timeout = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (check()) return;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for: ${message}`);
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function streamResponse(chunks) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  };
}

function boot({ authRequired = false, savedPassword = '', chatHandler, models } = {}) {
  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), {
    runScripts: 'dangerously',
    url: 'http://localhost:3111/',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  window.Headers = global.Headers;
  window.AbortController = global.AbortController;
  window.TextDecoder = global.TextDecoder;
  window.TextEncoder = global.TextEncoder;
  window.ReadableStream = global.ReadableStream;
  window.DOMException = global.DOMException;
  window.confirm = () => true;

  // Execute the real vendored bundles, as a browser would.
  window.eval(markedSource);
  window.eval(purifySource);

  if (savedPassword) window.localStorage.setItem('appPassword', savedPassword);

  const calls = [];
  window.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/status') {
      return jsonResponse({ mode: 'local', connected: true, authRequired, lanIp: '192.168.1.5' });
    }
    if (url === '/api/auth/verify') {
      const headers = options.headers instanceof Headers ? options.headers : new Headers(options.headers || {});
      return headers.get('X-App-Password') === 'goodpass'
        ? jsonResponse({ ok: true })
        : jsonResponse({ error: 'Unauthorized' }, 401);
    }
    if (url === '/api/login') {
      const body = JSON.parse(options.body);
      return body.password === 'goodpass'
        ? jsonResponse({ success: true })
        : jsonResponse({ error: 'Invalid' }, 401);
    }
    if (url === '/api/models') {
      return jsonResponse({
        models: models || [{ name: 'llama3:8b' }, { name: 'glm-4.7:cloud' }],
        source: 'local',
        stale: false,
      });
    }
    if (url === '/api/chats') {
      return jsonResponse([{
        id: 7,
        title: '<img src=x onerror="window.__xss=1">',
        model: 'llama3:8b',
        updated_at: '2026-10-27 12:00:00',
      }]);
    }
    if (url === '/api/chat' && options.method === 'POST') {
      if (chatHandler) return chatHandler(options);
      return streamResponse([
        'data: {"type":"chat_created","chatId":9}\n\n',
        'data: {"message":{"role":"assistant","content":"**Hello** "},"done":false}\n\n',
        'data: {"message":{"role":"assistant","content":"from jsdom ✅"},"done":false}\n\n',
        'data: {"done":true}\n\n',
      ]);
    }
    if (url.startsWith('/api/chats/')) {
      return jsonResponse({ id: 7, title: 'saved', model: 'llama3:8b', messages: [] });
    }
    return jsonResponse({ error: `not stubbed: ${url}` }, 404);
  };

  window.eval(appSource);
  return { window, calls };
}

test('ships no CDN scripts or inline event handlers', () => {
  assert.ok(!/<script[^>]+https?:\/\//i.test(html), 'external scripts are still referenced');
  assert.ok(!/\son\w+\s*=/.test(html), 'inline event handlers are not allowed under the CSP');
  assert.ok(fs.existsSync(path.join(publicDir, 'vendor', 'marked.umd.js')));
  assert.ok(fs.existsSync(path.join(publicDir, 'vendor', 'purify.min.js')));
});

test('vendored libraries parse Markdown and strip event handlers', () => {
  const { window } = boot();
  assert.equal(typeof window.marked.parse, 'function');
  assert.equal(typeof window.DOMPurify.sanitize, 'function');
  assert.ok(window.marked.parse('**bold**').includes('<strong>'));
  assert.ok(!window.DOMPurify.sanitize('<img src=x onerror="alert(1)">').includes('onerror'));
});

test('renders models, the empty state, and stored titles as inert text', async () => {
  const { window } = boot();
  await until(() => window.document.getElementById('current-model-name').textContent === 'llama3:8b',
    'model list to load');

  const doc = window.document;
  assert.ok(doc.querySelectorAll('#model-list .model-option').length >= 2);
  assert.match(doc.getElementById('messages-area').textContent, /Start a conversation using llama3:8b/);

  await until(() => doc.querySelector('.chat-item-title'), 'chat list to load');
  const title = doc.querySelector('.chat-item-title');
  assert.equal(title.textContent, '<img src=x onerror="window.__xss=1">');
  assert.equal(doc.querySelectorAll('#chat-list img').length, 0, 'stored title was rendered as HTML');
  assert.equal(window.__xss, undefined);
});

test('groups local, free cloud, and paid cloud models separately', async () => {
  const { window } = boot({
    models: [
      { name: 'llama3:8b' },
      { name: 'gpt-oss:120b-cloud' },
      { name: 'nemotron-3-super:cloud' },
      { name: 'glm-4.7:cloud' },
    ],
  });
  const doc = window.document;
  await until(() => doc.getElementById('current-model-name').textContent === 'llama3:8b',
    'model list to load');

  const groups = [...doc.querySelectorAll('.model-group')];
  assert.deepEqual(groups.map((group) => group.dataset.group), ['local', 'free', 'paid']);

  const namesIn = (key) => [...doc.querySelectorAll(`.model-group[data-group="${key}"] .model-name`)]
    .map((element) => element.textContent);
  assert.deepEqual(namesIn('local'), ['llama3:8b']);
  assert.deepEqual(namesIn('free'), ['gpt-oss:120b-cloud', 'nemotron-3-super:cloud']);
  assert.deepEqual(namesIn('paid'), ['glm-4.7:cloud']);

  assert.equal(doc.querySelector('.model-group[data-group="free"] .tier-chip').textContent, 'Free');
  assert.equal(doc.querySelector('.model-group[data-group="paid"] .tier-chip').textContent, 'Paid');

  // The empty state names the cost of the selected cloud model.
  doc.querySelector('.model-option[data-value="glm-4.7:cloud"]').click();
  assert.match(doc.querySelector('.empty-note').textContent, /paid plan or usage credits/);
  assert.ok(doc.querySelector('.empty-note').classList.contains('is-paid'));

  doc.querySelector('.model-option[data-value="gpt-oss:120b-cloud"]').click();
  assert.match(doc.querySelector('.empty-note').textContent, /free plan/);
  assert.ok(!doc.querySelector('.empty-note').classList.contains('is-paid'));
});

test('groups cloud catalog models that carry no cloud suffix', async () => {
  // The cloud API lists `gemma4:31b`; only the CLI appends `:cloud`. The
  // server tags the source, so grouping must rely on the flag, not the name.
  const { window } = boot({
    models: [
      { name: 'llama3:8b', cloud: false },
      { name: 'gpt-oss:20b', cloud: true },
      { name: 'gemma4:31b', cloud: true },
      { name: 'nemotron-3-ultra', cloud: true },
      { name: 'deepseek-v4-pro:0813', cloud: true },
      { name: 'qwen3:30b', cloud: false },
    ],
  });
  const doc = window.document;
  await until(() => doc.getElementById('current-model-name').textContent === 'llama3:8b',
    'model list to load');

  const groups = [...doc.querySelectorAll('.model-group')];
  assert.deepEqual(groups.map((group) => group.dataset.group), ['local', 'free', 'paid']);

  const namesIn = (key) => [...doc.querySelectorAll(`.model-group[data-group="${key}"] .model-name`)]
    .map((element) => element.textContent);
  assert.deepEqual(namesIn('local'), ['llama3:8b', 'qwen3:30b']);
  assert.deepEqual(namesIn('free'), ['gpt-oss:20b', 'gemma4:31b', 'nemotron-3-ultra']);
  assert.deepEqual(namesIn('paid'), ['deepseek-v4-pro:0813']);

  doc.querySelector('.model-option[data-value="deepseek-v4-pro:0813"]').click();
  assert.match(doc.querySelector('.empty-note').textContent, /paid plan or usage credits/);

  doc.querySelector('.model-option[data-value="gemma4:31b"]').click();
  assert.match(doc.querySelector('.empty-note').textContent, /free plan/);
});

test('streams a reply, renders Markdown, and resets the send button', async () => {
  const { window } = boot();
  const doc = window.document;
  await until(() => doc.getElementById('current-model-name').textContent === 'llama3:8b',
    'model list to load');

  const input = doc.getElementById('user-input');
  const send = doc.getElementById('send-btn');
  assert.equal(send.disabled, true);

  input.value = 'hello there';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(send.disabled, false);

  send.click();
  await until(() => !send.classList.contains('stop'), 'stream to finish');

  const userMessage = doc.querySelector('.user-msg .message-content');
  assert.ok(userMessage.textContent.includes('hello there'));

  const assistant = [...doc.querySelectorAll('.assistant-msg .message-content')].pop();
  assert.ok(assistant.querySelector('strong'), 'Markdown was not rendered');
  assert.ok(assistant.textContent.includes('from jsdom ✅'));
  assert.equal(doc.querySelectorAll('.message-error').length, 0);
});

test('the stop button aborts the stream and reports it', async () => {
  let aborted = false;
  const { window } = boot({
    chatHandler: (options) => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"message":{"content":"partial"},"done":false}\n\n'));
          options.signal.addEventListener('abort', () => {
            aborted = true;
            try { controller.error(new DOMException('Aborted', 'AbortError')); } catch (error) { /* closed */ }
          });
        },
      }),
    }),
  });

  const doc = window.document;
  await until(() => doc.getElementById('current-model-name').textContent === 'llama3:8b',
    'model list to load');

  const input = doc.getElementById('user-input');
  const send = doc.getElementById('send-btn');
  input.value = 'long answer please';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  send.click();
  await until(() => send.classList.contains('stop'), 'streaming to start');

  send.click();
  await until(() => !send.classList.contains('stop'), 'streaming to stop');

  assert.equal(aborted, true);
  assert.match(doc.getElementById('messages-area').textContent, /Generation stopped/);
});

test('verifies a saved password and rejects a bad one', async () => {
  const good = boot({ authRequired: true, savedPassword: 'goodpass' });
  await until(() => good.window.document.getElementById('current-model-name').textContent === 'llama3:8b',
    'authenticated init');
  assert.ok(good.calls.some((call) => call.url === '/api/auth/verify'));
  assert.equal(good.window.document.getElementById('login-overlay').style.display, 'none');

  const bad = boot({ authRequired: true, savedPassword: 'badpass' });
  await until(() => bad.window.document.getElementById('login-overlay').style.display === 'flex',
    'login overlay for a rejected password');
  assert.match(bad.window.document.getElementById('login-error').textContent, /rejected/);
  assert.equal(bad.window.localStorage.getItem('appPassword'), null);
});
