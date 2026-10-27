'use strict';

// Local Ollama can serve cloud models it proxies (connected with
// `ollama connect`): the entries carry a `remote_host`/`remote_model` pair and
// usually a `:cloud` suffix, but the source is still "local". /api/models must
// tag them as cloud so the picker separates them from truly local models.
// This suite boots a real server in local mode against a mock Ollama.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-connected-test-'));
const LOCAL_MODELS = [
  { name: 'llama3:8b' },
  { name: 'beam:cloud', remote_model: 'beam', remote_host: 'https://ollama.com' },
  { name: 'gemma4:cloud', remote_model: 'gemma4:31b', remote_host: 'https://ollama.com' },
  { name: 'gemini-3-flash-preview:latest', remote_model: 'gemini-3-flash-preview', remote_host: 'https://ollama.com:443' },
];

let mock;
let child;
let base;

test.before(async () => {
  mock = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ models: LOCAL_MODELS }));
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const localUrl = `http://127.0.0.1:${mock.address().port}`;

  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      MODE: 'local',
      HOST: '127.0.0.1',
      PORT: '0',
      APP_PASSWORD: '',
      OLLAMA_HOST: localUrl,
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

test('tags proxied cloud models served by local Ollama', async () => {
  const response = await fetch(`${base}/api/models`);
  assert.equal(response.status, 200);
  const data = await response.json();

  assert.equal(data.source, 'local');
  const byName = Object.fromEntries(data.models.map((model) => [model.name, model]));
  assert.equal(byName['llama3:8b'].cloud, false, 'local models stay untagged as cloud');
  assert.equal(byName['beam:cloud'].cloud, true);
  assert.equal(byName['gemma4:cloud'].cloud, true);
  assert.equal(byName['gemini-3-flash-preview:latest'].cloud, true,
    'proxied models without a :cloud suffix are cloud because of remote_host');
});
