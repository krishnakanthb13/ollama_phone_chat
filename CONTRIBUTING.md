# Contributing to Ollama Phone Chat

First off, thank you for considering contributing to Ollama Phone Chat! It's people like you that make this project better for everyone.

---

## How Can I Contribute?

### Reporting Bugs
If you find a bug, please search existing issues to see if it has already been reported. If not, open a new issue and include:
-   **Device info**: (e.g., iPhone 13, Android 12, Chrome Mobile).
-   **Steps to reproduce**: Clear, numbered steps.
-   **Expected vs. Actual behavior**.
-   **Server logs**: Any errors visible in your terminal.

### Suggesting Enhancements
Have an idea for a new feature? We'd love to hear it! Open an issue with the "feature request" tag and describe:
-   The problem this feature would solve.
-   How it should work from a user perspective.

### Pull Requests
1.  **Fork** the repository and create your branch from `main`.
2.  **Install dependencies**: `npm install`.
3.  **Make your changes**: Ensure your code follows the existing style (Vanilla JS/CSS).
4.  **Test**: Run `npm test` and verify your changes on both a desktop and a mobile browser.
5.  **Document**: Update `CODE_DOCUMENTATION.md` if you changed the architecture or added new modules.
6.  **Submit**: Open a Pull Request with a clear description of your changes.

---

## Local Development Setup

1.  **Requirements**: [Node.js](https://nodejs.org/) **20.17 or newer** (required by `sqlite3` 6) and, for local mode, [Ollama](https://ollama.com/).
2.  **Clone the repo**:
    ```bash
    git clone https://github.com/krishnakanthb13/ollama_phone_chat.git
    cd ollama_phone_chat
    ```
3.  **Install**:
    ```bash
    npm install
    ```
4.  **Configure** (optional):
    ```bash
    cp .env.example .env
    ```
    Set `APP_PASSWORD` to exercise encryption and authentication, or leave it
    empty for plaintext LAN-only development.
5.  **Start**:
    - Ensure Ollama is running for local mode.
    - Run `node server.js` or `npm start`.
    - Scan the QR code with your phone.
6.  **Test**:
    ```bash
    npm test
    ```
    The suites use temporary databases, temporary model caches, ephemeral
    ports, and a mock Ollama server, so they never touch your real history.

---

## Standards & Style

-   **Vanilla JS**: We avoid large frameworks to keep the project lightweight. Use modern ES6+ features.
-   **Mobile-First CSS**: Always design for small screens first, then use media queries for larger displays.
-   **Clean UI**: Keep the interface minimalist and focus on the chat experience.
-   **No inline scripts or event handlers**: The server sends `script-src 'self'`; all behaviour belongs in `public/app.js`.
-   **No CDN dependencies**: Frontend libraries are vendored in `public/vendor/`. If you update one, follow the version, license, and hash steps in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
-   **Tests**: Add or update a `node:test` case for behaviour changes. Do not commit generated files such as `.env`, `data/chats.db`, or `models_cache.json`.

---

## Author & Maintainer
-   **Krishna Kanth B** ([@krishnakanthb13](https://github.com/krishnakanthb13))

---

## License
By contributing, you agree that your contributions will be licensed under the **GNU GPL v3**.
