# Release Notes v0.0.4 - Initial Public Release

**Ollama Phone Chat** is a seamless, mobile-first bridge for identifying and chatting with your local Ollama models. It transforms your desktop's powerful AI capabilities into a premium, private, and secure mobile experience.

---

## 🚀 Top Features

### � Premium Mobile Experience
- **Mobile-First UI**: Designed specifically for thumbs and small screens, feeling like a native app.
- **Zero-Config Connection**: Simply scan the QR code generated in your terminal to connect instantly over your local Wi-Fi.
- **Responsive Design**: Smooth animations, glassmorphism effects, and a polished dark mode.

### 🧠 Advanced Model Interaction
- **"Thinking" Visualization**: Native support for reasoning models like **DeepSeek-R1**. Watch the model's thought process unfold in a collapsible "Thinking..." block before the final answer.
- **Streaming Responses**: Real-time token streaming for a snappy, conversational feel.
- **Markdown & Code**: Full support for Markdown rendering, tables, and syntax-highlighted code blocks with one-tap copy.

### 🔒 Enterprise-Grade Security (New!)
- **Transparent Data Encryption (TDE)**: All chat history is encrypted at rest using **AES-256-CBC** when an app password is set. Use the `APP_PASSWORD` env variable to enable this.
- **Secure Access Control**: Lock your bridge with a password. A secure login overlay prevents unauthorized access from anyone else on your LAN.
- **Privacy First**: 100% local. Your data, chats, and model inference never leave your home network.

### ⚙️ Customization & Control
- **Quality Presets**: Switch between **High**, **Medium**, and **Low** quality modes directly from your phone to balance speed vs. precision.
- **Font Size Controls (New!)**: Adjust text size (Small, Medium, Large) on the fly for optimal readability.
- **Persistent History**: All conversations are stored locally in a high-performance SQLite database. Resume your chats anytime.

---

## 🛠️ Technical Highlights
- **Backend**: Node.js + Express
- **Database**: SQLite3 (Promisified & Encrypted)
- **Frontend**: Vanilla JS (No build steps required), marked.js, DOMPurify
- **Protocol**: Server-Sent Events (SSE) for efficient streaming

---

## 🚀 Getting Started

1.  **Prerequisites**: Ensure [Ollama](https://ollama.com/) is running on your machine.
2.  **Install**:
    ```bash
    git clone https://github.com/krishnakanthb13/ollama_phone_chat.git
    cd ollama_phone_chat
    npm install
    ```
3.  **Secure (Optional)**: Add a password to `.env`:
    ```env
    APP_PASSWORD=your_secret_password
    OLLAMA_API_KEY=your_secret_ollama_password
    MODE=auto/local/cloud
    ```
4.  **Run**:
    ```bash
    npm start
    ```
5.  **Connect**: Scan the QR code with your phone and start chatting!
