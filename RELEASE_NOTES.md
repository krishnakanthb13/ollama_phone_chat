# Release Notes — v0.0.16

**Ollama Phone Chat** is a local-first bridge for chatting with Ollama models
from a phone on the same Wi-Fi network. The server runs on your computer, the
UI runs in the phone's browser, and no account or third-party service is
involved.

This release fixes a regression in v0.0.15: when the app was running against
Ollama Cloud, the model picker showed every model under **Local** and the
**Cloud** groups never appeared.

---

## 🐞 The bug

The picker decided whether a model was local or cloud by looking at its name.
Cloud models were expected to end in `:cloud` or `-cloud`, because that is how
the Ollama CLI labels them. The cloud **API**, however, returns plain names:

```
GET https://ollama.com/api/tags   →   gemma4:31b, gpt-oss:20b, ...
ollama list (CLI)                 →   gemma4:cloud, gpt-oss:cloud, ...
```

With `MODE=cloud` (or `MODE=auto` and no local Ollama running), every name
failed the suffix test, so the whole catalogue was grouped as local. The status
pill correctly said **Cloud** while the picker offered a **Local** section —
the two disagreed because each used a different signal.

## 🔧 The fix

- **The server now states the source.** `/api/models` tags each entry with
  `cloud: true` or `cloud: false`, because the server is the only place that
  knows whether the list came from the local daemon or the cloud catalogue.
- **The cache remembers its origin.** `models_cache.json` now stores `source`
  next to `models` and `cachedAt`, so a cloud list served from the fallback
  cache keeps its cloud tag instead of silently becoming local.
- **The client trusts the tag.** Grouping, the cloud capability icon, and the
  empty-state cost note read the tag first and only fall back to the suffix
  heuristic for hand-written lists or caches written before this release.
- **Free tier matching is unchanged.** Names are still compared with any
  `:cloud` / `-cloud` suffix removed, so `gemma4:cloud` and `gemma4:31b` resolve
  to the same free entry. Local models that happen to share a free cloud name
  are still never marked as cloud.

## ☁️ What the picker shows now

In cloud mode:

```
CLOUD  [FREE]  7
  beam, gemma4:31b, gpt-oss:20b, gpt-oss:120b,
  nemotron-3-nano:30b, nemotron-3-super, nemotron-3-ultra

CLOUD  [PAID]  5
  deepseek-v4-pro:0813, glm-5.3, kimi-k2.7-code, ...
```

In local mode the **Local** group is unchanged, and a mixed list still shows
all three groups in the order Local → Cloud · Free → Cloud · Paid. The empty
state keeps repeating the cost of the selected model.

## 🧪 Testing

`npm test` now runs 26 `node:test` assertions:

- a new jsdom test feeds cloud-style names without any suffix (`gemma4:31b`,
  `deepseek-v4-pro:0813`) and asserts the group order, membership, tier chips,
  and both empty-state cost notes;
- a new integration test boots a real server in cloud mode against a mock
  `/tags` endpoint and asserts that the catalogue is tagged `cloud: true`, that
  the cache records `source: "cloud"`, and that a cached list served after the
  catalogue goes away keeps its tag;
- the local-mode API test now asserts that local models are tagged
  `cloud: false` and that the cache records `source: "local"`.

The picker was also verified in headless Chrome at 1440×900 and 500×900 in
both themes against a cloud catalogue, and the change was checked end to end
against the live cloud API (23 models, all tagged).

---

## ⚙️ Upgrade notes

- Restart the server after updating; the first `/api/models` call rewrites the
  cache with its source.
- `app.js` is now requested as `?v=6`. `styles.css` is unchanged at `?v=5`.
- No configuration, API, or database changes. `MODE`, `OLLAMA_API_KEY`, and
  `OLLAMA_CLOUD_URL` work as before.

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
