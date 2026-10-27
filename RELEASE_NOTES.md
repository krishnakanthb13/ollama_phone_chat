# Release Notes — v0.0.13

**Ollama Phone Chat** is a local-first bridge for chatting with Ollama models
from a phone on the same Wi-Fi network. The server runs on your computer, the
UI runs in the phone's browser, and no account or third-party service is
involved.

This release is the result of a full audit of the codebase. The focus is
correctness and security rather than new surface area: encryption, streaming,
database integrity, HTTP validation, the frontend, and the dependency tree
were all reviewed, fixed, and covered by tests.

---

## 🔒 Security

- **AES-256-GCM at rest.** Chat titles, message content, and "thinking"
  blocks are encrypted with GCM when `APP_PASSWORD` is set. The key is derived
  with scrypt and a per-install salt (`data/.key_salt`), and a key-check value
  detects a wrong password instead of returning corrupted text. Legacy
  AES-256-CBC rows from v0.0.4 remain readable.
- **Strict Content-Security-Policy.** `script-src 'self'` with no inline
  handlers, plus `object-src 'none'`, `base-uri 'none'`, `frame-ancestors
  'none'`, and `connect-src 'self'`. `marked` and DOMPurify are vendored, so
  the UI works offline and never loads a CDN.
- **DOM-based rendering.** Chat titles, user messages, and thinking blocks are
  inserted with `textContent`. Assistant Markdown is sanitized with DOMPurify,
  so stored model output cannot inject HTML or scripts.
- **Hardened HTTP layer.** All request bodies are validated, non-API routes
  return JSON errors, login attempts are rate limited, and logins from
  cross-origin pages are rejected. API errors do not leak stack traces.
- **No advisories.** `npm audit` reports zero vulnerabilities after the
  dependency upgrades below.

## 🛠️ Reliability

- Chat and model requests use Node's built-in `fetch`; the undeclared
  `node-fetch` dependency is gone.
- Stream decoding is incremental, so split UTF-8 sequences and multi-line SSE
  events are handled correctly.
- The database enables foreign keys, WAL journaling, a busy timeout,
  migrations, and an index for message reads and retry idempotency. Deleting a
  chat removes its messages.
- A chat is created only after Ollama accepts the request, so failed or
  cancelled calls leave no empty history behind.
- Retries carry a `clientMessageId`; a repeated send cannot duplicate the user
  turn.
- The send button becomes a **Stop** button while streaming. Aborting keeps
  the partial reply, and the server shuts down gracefully on `SIGINT` /
  `SIGTERM`.
- The terminal prints the best LAN address first (virtual adapters and
  link-local addresses are deprioritized), followed by alternatives and a QR
  code for the chosen address.

## 📱 Interface

- Mobile-first layout with accessible labels, keyboard focus rings,
  `aria-pressed` toggles, live-region messages, and a re-enabled pinch zoom.
- Markdown repaints at most once per animation frame, which keeps long replies
  responsive on phones.
- Model output, error states, and the empty state are rendered consistently.
  Timestamps from SQLite are treated as UTC.
- Saved passwords are verified against `/api/auth/verify` before use, and a
  `401` returns to the login screen after clearing the stored password.

## 🧪 Testing

`npm test` runs four `node:test` suites against temporary databases, temporary
caches, ephemeral ports, and a mock Ollama server:

- database encryption, legacy CBC reads, retry idempotency, cascades,
  plaintext mode, and wrong-password handling;
- HTTP status/LAN reporting, security headers, CSP, offline assets,
  authentication, validation, streaming, persistence, upstream failures, and
  login throttling;
- a jsdom run of the real HTML and vendored bundles for inert titles,
  Markdown sanitization, streaming, stop/abort, and saved-password handling.

---

## ⚙️ Requirements and upgrade notes

- **Node.js 20.17 or newer** is now required. Express was upgraded to 5.3 and
  `sqlite3` to 6.0; the older versions carried critical advisories.
- Run `npm install` after updating so the new native SQLite binding and
  Express 5 tree are installed.
- Copy `.env.example` to `.env` to see every supported setting.
- Changing or removing `APP_PASSWORD` makes existing encrypted history
  unreadable. Back up `data/chats.db` and `data/.key_salt` before rotating the
  password.

## 🚀 Getting started

```bash
git clone https://github.com/krishnakanthb13/ollama_phone_chat.git
cd ollama_phone_chat
npm install
npm start
```

Scan the QR code shown in the terminal, or open the printed LAN URL on a phone
connected to the same network. If Ollama is not running locally and you have a
cloud API key, set `MODE=cloud` and `OLLAMA_API_KEY` in `.env`.

## 🧱 Stack

- **Backend:** Node.js, Express 5, built-in `fetch`
- **Database:** SQLite via `sqlite3` 6, AES-256-GCM encryption
- **Frontend:** vanilla JS, vendored `marked` 18.1.2 and DOMPurify 3.4.17
- **Protocol:** Server-Sent Events (SSE)

Licenses and checksums for the vendored libraries are in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
