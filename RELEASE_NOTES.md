# Release Notes — v0.0.17

**Ollama Phone Chat** is a local-first bridge for chatting with Ollama models
from a phone on the same Wi-Fi network. The server runs on your computer, the
UI runs in the phone's browser, and no account or third-party service is
involved.

This release is about comfort: a smaller text scale, five palettes to read in
besides the system one, and unsent drafts that no longer disappear when you
switch conversations or reload the page.

---

## 🔤 Text size

The scale shifted down one step and gained a floor:

| Button | Before | Now |
| :--- | :--- | :--- |
| A (small) | 14px | **12px** |
| A (medium) | 16px | **14px** |
| A (large) | 18px | **16px** |

Everything in the interface is sized in `rem`, so one click rescales the
composer, the transcript, the sidebar, and the dialogs together. The choice is
still stored under `fontSize`, so existing visitors keep their preference
position; `medium` remains the default.

## 🎨 Palettes

The theme toggle now cycles **Auto → Light → Sage → Dark → Ember → Midnight**:

- **Light** — warm paper with a teal accent (unchanged).
- **Sage** — herb-garden daylight: soft greens and a deep leaf accent.
- **Dark** — deep petrol with verdigris (the signal-desk palette, unchanged).
- **Ember** — plum ink lit by warm amber.
- **Midnight** — deep navy with an ice-blue accent.

Auto still leaves the `data-theme` attribute off so `prefers-color-scheme`
decides; explicit themes set it and therefore win over the system. The two
`theme-color` meta tags follow the active palette, so the browser chrome on a
phone matches the page instead of flashing the wrong colour. The chosen theme
is stored under `theme` as before.

## ✍️ Draft autosave

Unsent text is now kept per conversation:

- typing stores the composer under `drafts` in `localStorage`, keyed by `new`
  for a conversation that has not been sent yet and `chat:<id>` afterwards;
- switching chats parks the current draft and restores the target's, so a
  half-written question never lands in the wrong conversation;
- sending consumes only the active draft;
- the history list shows a small **Draft** badge on conversations that hold
  unsent text, updated in place without re-rendering the list;
- if the first message is still starting when you type the next one, the text
  is moved to the new chat id as soon as the server creates it;
- storage problems (private mode, full quota) are swallowed: drafts are
  best-effort and never break chatting.

## 🧪 Testing

`npm test` now runs 29 `node:test` assertions. New jsdom coverage:

- the three text sizes apply 12px / 14px / 16px to the root, persist the
  choice, and move the active state;
- the theme button visits all five palettes in order, updates the label and
  both `theme-color` metas, then returns to Auto with the media-scoped colours
  restored;
- drafts survive a chat switch and a new conversation, show the history badge,
  and are cleared only for the conversation that was sent.

The interaction smoke pass (16 checks) and the existing server, security, and
cloud-model suites still pass. Palettes, drafts, and the picker were checked in
headless Chrome at 1440×900 and 500×900, including Auto following a light and a
dark system preference.

---

## ⚙️ Upgrade notes

- Restart the server and hard-refresh once. `styles.css` is now requested as
  `?v=6` and `app.js` as `?v=7`.
- No configuration, API, or database changes. Existing `theme` (`light`,
  `dark`) and `fontSize` values remain valid; `large` now means 16px.
- If you had custom CSS pinned to the old `:root:not([data-theme='dark'])`
  selector, note the auto-light block is now `:root:not([data-theme])`.

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
