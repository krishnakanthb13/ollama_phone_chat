# Release Notes — v0.0.18

**Ollama Phone Chat** is a local-first bridge for chatting with Ollama models
from a phone on the same Wi-Fi network. The server runs on your computer, the
UI runs in the phone's browser, and no account or third-party service is
involved.

This release is about knowing what a model costs before you send: the free
cloud models now lead the model picker in their own group, and cloud models
that your local Ollama proxies are recognised as cloud instead of being
buried under "Local".

---

## ☁️ Free cloud models first

The picker now lists groups in this order:

1. **Cloud · Free** — the models that draw from free usage, with a green
   `Free` chip;
2. **Local** — models running on your machine;
3. **Cloud · Paid** — everything else, with an amber `Paid` chip.

The free group is keyed by Ollama's published free-usage list: `beam`,
`gemma4:31b`, `gpt-oss:120b`, `gpt-oss:20b`, `nemotron-3-nano:30b`,
`nemotron-3-super`, and `nemotron-3-ultra`. The paid group ends with a note —
"Add usage credits to pay as you go, or upgrade to use any cloud model" — that
links to [ollama.com/settings](https://ollama.com/settings).

## 🔌 Proxied cloud models are recognised

When the Ollama app connects cloud models to your local daemon
(`ollama connect`), `/api/tags` returns them with a `remote_host` pointing at
`ollama.com` — often with a `:cloud` suffix, but not always
(`gemini-3-flash-preview:latest`). The server tagged every local-mode entry as
`cloud: false`, so the whole catalog landed under **Local** and the cloud
groups never appeared.

`/api/models` now tags an entry as cloud when the source is the cloud
catalog, when it carries a `remote_host`, or when its name ends in
`:cloud`/`-cloud`. Free-tier matching prefers `remote_model`, so the proxied
alias `gemma4:cloud` resolves to `gemma4:31b`, and the client falls back to
`remote_host` for caches written without a server tag. Aliases of the same
upstream model (`gemma4:cloud` and `gemma4:31b-cloud`) are deduplicated by
upstream name, so the free group shows exactly one row per model.

## 🧪 Testing

`npm test` now runs 31 `node:test` assertions. New coverage:

- `test/local-connected-models.test.js` (new): boots a real server in local
  mode against a mock daemon serving proxied entries and asserts that
  `remote_host`/`:cloud` entries are tagged `cloud: true` while plain local
  models stay `false`;
- `test/frontend.test.js`: a jsdom case feeds the proxied shapes
  (`beam:cloud`, `gemma4:cloud` with `remote_model`, an unsuffixed
  `remote_host` entry) and asserts the free/local/paid order, free membership,
  alias deduplication, and the paid settings link;
- `test/server.test.js`: the local-mode mock's `glm-4.7:cloud` entry must now
  be tagged cloud while `llama3:8b` stays local.

Verified against a live local daemon: all 61 catalog entries came back with
correct tags and all seven free models grouped under **Cloud · Free**.

---

## ⚙️ Upgrade notes

- Restart the server and hard-refresh once. `styles.css` is now requested as
  `?v=7` and `app.js` as `?v=8`.
- No configuration, API, or database changes. The free-model list stays in
  `FREE_CLOUD_MODELS` at the top of `app.js` if Ollama changes it.
- The paid group's settings link opens in a new tab; nothing else moved.

## 🚀 Getting started

```bash
git clone https://github.com/krishnakanthb13/ollama_phone_chat.git
cd ollama_phone_chat
npm install
npm start
```

Scan the QR code shown in the terminal, or open the printed LAN URL on a phone
connected to the same network. If Ollama is not running locally and you have a
cloud API key, set `MODE=cloud` (or `auto`) and `OLLAMA_API_KEY` in `.env`.

## 🧱 Stack

- **Backend:** Node.js, Express 5, built-in `fetch`
- **Database:** SQLite via `sqlite3` 6, AES-256-GCM encryption
- **Frontend:** vanilla JS, vendored `marked` 18.1.2, DOMPurify 3.4.17,
  Bricolage Grotesque Variable, and Instrument Sans Variable
- **Protocol:** Server-Sent Events (SSE)

Licenses and checksums for the vendored libraries and fonts are in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
