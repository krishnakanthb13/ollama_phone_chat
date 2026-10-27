# Release Notes — v0.0.14

**Ollama Phone Chat** is a local-first bridge for chatting with Ollama models
from a phone on the same Wi-Fi network. The server runs on your computer, the
UI runs in the phone's browser, and no account or third-party service is
involved.

This release is a UI/UX pass. Behaviour, endpoints, storage, and security
posture are unchanged; the interface was rebuilt around a clearer reading
surface, a calmer composer, and a theme that follows the room you are in.

---

## 🎨 Design

- **New visual direction: "signal desk".** Deep petrol ink (`#0a1215`) with a
  verdigris accent (`#7ce3cb`), hairline borders, and restrained motion. Chat
  content sits on a single reading column (max 820px) instead of overlapping
  panels.
- **Warm-paper light theme.** `#f4f1e8` paper with a teal (`#0f766e`) accent,
  selected automatically from `prefers-color-scheme`. The sidebar footer cycles
  **Auto → Light → Dark**, and the choice persists in `localStorage`.
- **Self-hosted typography.** Bricolage Grotesque (display) and Instrument Sans
  (body/UI) are vendored as latin-subset WOFF2 files and preloaded. No CDN, no
  font requests outside the app origin, still compatible with `font-src 'self'`.
- **One icon language.** An inline SVG sprite replaces text glyphs for menus,
  close buttons, send/stop, the delete action, and the brand mark.

## 🧭 Layout and interaction

- The header, transcript, and composer are now a flex column. The old
  `padding: 85px` / `100px` + `z-index` workarounds are gone, so the last
  message can never hide behind the composer and the header never overlaps
  content. Below 900px the history sidebar is an overlay drawer with a
  dimming scrim.
- **Composer tools row.** Web search, thinking output, and reasoning quality
  moved out of the crowded header into chips above the input. Chips only appear
  for models whose names advertise the capability, and they expose
  `aria-pressed` plus an `is-on` class instead of inline colors.
- **Empty state** rebuilt with the brand mark, a kicker, the active model name
  (`Start a conversation using …`), and four suggestion chips that fill and
  focus the composer without sending.
- **Scroll to latest** button appears when the transcript drifts more than
  160px from the bottom, so reading back through a long answer is no longer a
  trap.
- Streaming replies show a blinking caret that is removed as soon as the stream
  settles. Message time and copy actions are now siblings of the bubble, so
  copying a message never captures UI chrome.
- Model and quality pickers are proper dialogs: `aria-expanded` on the
  triggers, `Escape` closes any open sheet, and mobile gets a bottom-sheet
  layout with a drag handle.
- The status pill names the active mode (**Local**, **Cloud**, or **Offline**)
  instead of only recolouring a dot, and the sidebar shows the conversation
  count.

## ♿ Accessibility

- Visible `:focus-visible` rings on every interactive element, including custom
  `role="button"` chat rows and model options.
- `aria-pressed` on toggles, `role="log"` + `aria-live` on the transcript,
  `aria-expanded` on dialogs, labelled icon-only buttons, and a skip-free focus
  order that matches the visual order.
- Light-theme secondary text was darkened to keep small labels at or above
  WCAG AA contrast.
- `prefers-reduced-motion` collapses animations, transitions, and smooth
  scrolling to near-zero duration.

## 🧪 Testing

`npm test` still runs 23 `node:test` assertions across temporary databases,
ephemeral ports, and a mock Ollama server. The frontend suite loads the real
HTML and both vendored bundles in jsdom and continues to verify inert stored
titles, sanitized Markdown, streaming, stop/abort, and saved-password handling.
The UI was additionally checked in headless Chrome at 1440×900 and 500×900 in
both themes, with the model and quality sheets open and the sidebar expanded.

---

## ⚙️ Upgrade notes

- No configuration, API, or database changes. Updating the files is enough;
  run `npm install` only if you skipped a previous release.
- If you hard-code asset URLs, note that `styles.css` and `app.js` are now
  requested as `?v=5`.

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
