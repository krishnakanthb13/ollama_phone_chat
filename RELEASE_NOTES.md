# Release Notes — v0.0.15

**Ollama Phone Chat** is a local-first bridge for chatting with Ollama models
from a phone on the same Wi-Fi network. The server runs on your computer, the
UI runs in the phone's browser, and no account or third-party service is
involved.

Cloud usage is not uniform: some cloud models run on the free plan, while
others need a paid plan or added usage credits. That was invisible in the
picker. This release makes the cost of each choice explicit and keeps the
signal-desk interface from v0.0.14.

---

## ☁️ Cloud model tiers

- The model picker now lists **Local**, **Cloud · Free**, and **Cloud · Paid**
  as separate groups, each with a count. Local models stay first, so the
  offline-friendly choices remain the default path.
- The free group covers the models that draw from free usage: `beam`,
  `gemma4:31b`, `gpt-oss:120b`, `gpt-oss:20b`, `nemotron-3-nano:30b`,
  `nemotron-3-super`, and `nemotron-3-ultra`.
- Names are matched with any `:cloud` or `-cloud` suffix removed, because the
  CLI (`gemma4:cloud`) and the cloud API (`gemma4:31b`) label the same model
  differently.
- A **Free** chip marks the free cloud group; a **Paid** chip marks the group
  that requires a plan or usage credits. The empty state repeats the cost for
  the selected cloud model, so it is visible before the first message is sent.
- Local models are never marked as cloud, even when a cloud model shares the
  same base name (for example a pulled `gpt-oss:20b`).

Check your usage at <https://ollama.com/settings/usage> and compare plans at
<https://ollama.com/pricing>.

## 🎨 Interface

- Themes: deep petrol "signal desk" by night, warm paper by day, following
  `prefers-color-scheme` unless the sidebar toggle pins Auto, Light, or Dark.
- Bricolage Grotesque and Instrument Sans are vendored as latin-subset WOFF2
  files and preloaded, so the interface keeps its character offline and under
  `script-src 'self'` / `font-src 'self'`.
- Header, transcript, and composer form one flex column: the transcript owns
  the scroll, the composer never covers the last message, and the history
  sidebar becomes a drawer under 900px.
- Web search, thinking, and reasoning quality live in a composer chip row for
  models that advertise the capability, with `aria-pressed` state instead of
  inline colors.
- Empty-state suggestions fill the composer, a scroll-to-latest button appears
  when you read back, streaming replies carry a caret, and message actions sit
  beside the bubble so copying never captures UI chrome.
- Model and quality pickers are dialogs with `aria-expanded`, `Escape` to
  close, and a mobile bottom-sheet layout.

## ♿ Accessibility

- Visible `:focus-visible` rings, labelled icon-only buttons, `role="log"` on
  the transcript, and `aria-expanded` on dialogs.
- Light-theme secondary text keeps small labels at or above WCAG AA contrast.
- `prefers-reduced-motion` collapses animations, transitions, and smooth
  scrolling.

## 🧪 Testing

`npm test` runs 24 `node:test` assertions against temporary databases,
ephemeral ports, and a mock Ollama server. The frontend suite loads the real
HTML and both vendored bundles in jsdom and now also verifies the Local /
Cloud · Free / Cloud · Paid grouping, the tier chips, and the empty-state cost
note. The UI was checked in headless Chrome at 1440×900 and 500×900 in both
themes, with the model picker, quality sheet, sidebar, and login open.

---

## ⚙️ Upgrade notes

- No configuration, API, or database changes. Updating the files is enough;
  run `npm install` only if you skipped a previous release.
- The free-model list lives in `FREE_CLOUD_MODELS` in `public/app.js`; update
  it when Ollama changes its plans.
- Cached asset URLs remain at `?v=5`.

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
- **Frontend:** vanilla JS, vendored `marked` 18.1.2, DOMPurify 3.4.17,
  Bricolage Grotesque Variable, and Instrument Sans Variable
- **Protocol:** Server-Sent Events (SSE)

Licenses and checksums for the vendored libraries and fonts are in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
