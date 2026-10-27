'use strict';

// The cloud catalog (https://ollama.com/api/tags) returns plain model names
// such as `gemma4:31b`; only the CLI appends `:cloud`. The picker therefore
// cannot infer the source from the name, so /api/models must tag every entry.
// This suite boots a real server in cloud mode against a mock catalog.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-cloud-test-'));
const CLOUD_MODELS = [
  { name: 'gemma4:31b' },
  { name: 'gpt-oss:20b' },
  { name: 'nemotron-3-ultra' },
  { name: 'deepseek-v4-pro:0813' },
];

let mock;
let child;
let base;

test.before(async () => {
  mock = http.createServer((req, res) => {
    if (req.url === '/tags' && req.headers.authorization === 'Bearer test-key') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ models: CLOUD_MODELS }));
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const cloudUrl = `http://127.0.0.1:${mock.address().port}`;

  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      MODE: 'cloud',
      HOST: '127.0.0.1',
      PORT: '0',
      APP_PASSWORD: '',
      OLLAMA_API_KEY: 'test-key',
      OLLAMA_CLOUD_URL: cloudUrl,
      DB_PATH: path.join(TMP, 'chats.db'),
      MODELS_CACHE: path.join(TMP, 'models_cache.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  base = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`Server did not start in time:\n${output}`));
    }, 20000);
    const settle = (fn, value) => {
      clearTimeout(timer);
      fn(value);
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = /http:\/\/localhost:(\d+)/.exec(output);
      if (match) settle(resolve, `http://127.0.0.1:${match[1]}`);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('exit', (code) => {
      settle(reject, new Error(`Server exited with code ${code}:\n${output}`));
    });
  });
});

test.after(async () => {
  if (child && child.exitCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
  }
  if (mock) {
    if (typeof mock.closeAllConnections === 'function') mock.closeAllConnections();
    await new Promise((resolve) => mock.close(resolve));
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('tags cloud catalog models so the picker can group them', async () => {
  const response = await fetch(`${base}/api/models`);
  assert.equal(response.status, 200);
  const data = await response.json();

  assert.equal(data.source, 'cloud');
  assert.deepEqual(data.models.map((model) => model.name), CLOUD_MODELS.map((model) => model.name));
  assert.ok(data.models.every((model) => model.cloud === true), 'cloud models must be tagged');

  const cache = JSON.parse(fs.readFileSync(path.join(TMP, 'models_cache.json'), 'utf8'));
  assert.equal(cache.source, 'cloud');

  // With the catalog unreachable, the cached list must keep its cloud tag.
  if (typeof mock.closeAllConnections === 'function') mock.closeAllConnections();
  await new Promise((resolve) => mock.close(resolve));
  mock = null;

  const stale = await (await fetch(`${base}/api/models`)).json();
  assert.equal(stale.source, 'cache');
  assert.equal(stale.stale, true);
  assert.ok(stale.models.every((model) => model.cloud === true),
    'cached cloud models must stay tagged as cloud');
});
