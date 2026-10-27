# 📱 Ollama Phone Chat - Social Media Kit (v0.0.13)

## 💼 LinkedIn Post

**Headline:** Secure, Local AI on Your Phone – Ollama Phone Chat v0.0.13 🚀

I'm excited to share **Ollama Phone Chat**, a mobile-first bridge that lets you
talk to local LLMs (like Llama 3 or DeepSeek-R1) from your smartphone.

**Why use it?**
Most mobile AI apps rely on the cloud. This project keeps your prompts,
replies, and history on your own network. Your desktop does the inference; your
phone gets a polished, private client.

**Highlights in v0.0.13:**
🔒 **Encrypted history**: AES-256-GCM at rest with a key derived from your app
password via scrypt. Legacy v0.0.4 databases still open.
🧠 **"Thinking" support**: Watch a reasoning model's thought process in a
collapsible block before the final answer.
⏹️ **Stop generation**: Cancel a streaming reply and keep the partial answer.
📱 **Mobile-first UI**: Stroke-friendly controls, adjustable font size, and
Markdown that stays readable while it streams.
📴 **Offline UI**: Markdown rendering and sanitization libraries ship with the
app, under a strict Content-Security-Policy.

Completely open source and local-first.
Check it out on GitHub: [Link to Repo]

#LocalLLM #Ollama #DeepSeek #OpenSource #AI #Privacy #WebDevelopment

---

## 🤖 Reddit Post (r/LocalLLaMA, r/SelfHosted)

**Title:** I built a mobile bridge for Ollama so I could chat with DeepSeek-R1 from my couch (encrypted, offline UI)

Hey everyone,

I wanted a way to use my local Ollama models on my phone without exposing them
to the web or dealing with clunky UIs. So I built **Ollama Phone Chat**.

It's a zero-config Node.js app. You run it on your PC, scan a QR code, and
boom — you have a full chat interface on your phone.

**What's in v0.0.13:**
*   **Reasoning support**: Renders the model's thinking in a collapsible block,
    so the reasoning doesn't clutter the answer.
*   **Encrypted history**: If you set an app password, titles and messages are
    encrypted with AES-256-GCM in the local SQLite database. Existing data from
    older versions is still readable.
*   **Stop button**: Abort a long generation and keep what was already streamed.
*   **Mobile-first**: Dark mode, adjustable font size, and keyboard/touch
    accessibility.
*   **No CDN**: The UI loads offline and runs under `script-src 'self'`.
*   **Tested**: Database, server, and frontend suites run with `npm test`.

It's completely open source. I just pushed v0.0.13. Would love to hear what you
think!

[Link to GitHub Repo]

---

## 🐦 X (Twitter) Post

Run local LLMs on your phone with ZERO config. 📱🤖

**Ollama Phone Chat v0.0.13**:
✨ Chat with Llama 3, DeepSeek, & more over local Wi-Fi.
🧠 Native "Thinking" block for reasoning models.
⏹️ Stop a reply mid-stream and keep the partial answer.
🔒 AES-256-GCM encrypted history.
📴 Offline UI, no CDN, strict CSP.
🚫 No Cloud. 100% Private.

Just `npm start` and scan the QR code.

Grab it here: [Link to Repo]

#Ollama #LocalAI #DeepSeek #OpenSource #DevCommunity
