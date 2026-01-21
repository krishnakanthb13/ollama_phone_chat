# Ollama Phone Chat - Design Philosophy

## The Problem
Large Language Models (LLMs) running locally via [Ollama](https://ollama.com/) provide incredible privacy and power, but they are often "trapped" on the desktop. Accessing them from a mobile device usually requires complex network configurations, SSH tunnels, or third-party cloud services that compromise privacy.

## The Solution
**Ollama Phone Chat** is designed to be the "missing link" between your local AI hardware and your mobile lifestyle. It transforms your computer into a private AI home server with zero configuration.

---

## Core Principles

### 1. Zero-Config Connectivity
The barrier to entry should be non-existent. By generating a QR code directly in the terminal, we eliminate the need for users to type complex IP addresses or manage network discovery protocols. Scan and chat.

### 2. Privacy by Default
Your data never leaves your network. Unlike cloud-based AI interfaces, every prompt and response is stored on your own hardware in a local SQLite database. We follow the principle of "Local First, Local Only."

### 3. Mobile-First UX
Most AI interfaces are designed for desktops first and responsively "shrunk" for mobile. Ollama Phone Chat is built from the ground up for mobile interactions:
-   **Thumb-friendly controls**: Large tap targets and accessible menus.
-   **Streaming focus**: Real-time feedback is crucial on mobile networks.
-   **Battery efficient**: Lightweight frontend with minimal background processing.

### 4. Hardware Transparency
We don't hide the complexity of the models; we make it manageable. Features like "Thinking" blocks and quality presets allow users to dial in the performance of their specific hardware directly from their phone.

---

## Trade-offs & Constraints

-   **LAN Dependency**: By default, the application is restricted to your local area network (LAN). While this limits "true" remote access, it significantly increases security and performance.
-   **Stateless Backend**: The server acts as a thin bridge. While it handles history, most "intelligence" is offloaded to the Ollama instance, ensuring the bridge remains extremely lightweight and fast.
-   **Vanilla Stack**: We intentionally avoid heavy frameworks (like React or Vue) to ensure the application loads instantly on even older mobile devices.

---

## Target Users
-   **Developers** who want to test prompts while away from their desk.
-   **Privacy Enthusiasts** who refuse to use cloud AI but want the convenience of a mobile app.
-   **Home Labbers** turning their old PCs or Mac Minis into dedicated AI servers.
