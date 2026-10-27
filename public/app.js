/**
 * Copyright (c) 2026 Krishna Kanth B
 * Front-end controller for the Ollama Phone Chat bridge.
 *
 * Rendering is DOM-based: model output is never concatenated into HTML
 * strings, and Markdown is sanitized with DOMPurify before insertion.
 */

'use strict';

// --- State ---
const state = {
    currentChatId: null,
    currentModel: localStorage.getItem('lastModel') || '',
    chats: [],
    messages: [],
    isSidebarOpen: false,
    isConnected: false,
    isSending: false,
    models: [],
    appPassword: localStorage.getItem('appPassword') || '',
    abortController: null,
    initialized: false,
    mode: 'local',
};

const MAX_CONTEXT_MESSAGES = 40;
const MAX_CONTEXT_CHARS = 24000;
const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor">
  <path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/>
</svg>`;
const SEND_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M2.01 21L23 12L2.01 3L2 10L17 12L2 14L2.01 21Z" fill="currentColor"/>
</svg>`;
const STOP_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
</svg>`;

// --- DOM Elements ---
const dom = {
    app: document.getElementById('app'),
    sidebar: document.getElementById('sidebar'),
    overlay: document.getElementById('overlay'),
    menuBtn: document.getElementById('menu-btn'),
    closeSidebarBtn: document.getElementById('close-sidebar-btn'),
    chatList: document.getElementById('chat-list'),
    newChatBtn: document.getElementById('new-chat-btn'),
    statusIndicator: document.getElementById('status-indicator'),
    chatContainer: document.getElementById('chat-container'),
    scrollBottomBtn: document.getElementById('scroll-bottom-btn'),
    messagesArea: document.getElementById('messages-area'),
    textInput: document.getElementById('user-input'),
    sendBtn: document.getElementById('send-btn'),
    qualitySelect: document.getElementById('quality-select'),
    thinkingToggle: document.getElementById('thinking-toggle'),
    themeToggle: document.getElementById('theme-toggle'),
    chatCount: document.getElementById('chat-count'),
    loginOverlay: document.getElementById('login-overlay'),
    loginPassword: document.getElementById('login-password'),
    loginError: document.getElementById('login-error'),
    loginBtn: document.getElementById('login-btn'),
    togglePassword: document.getElementById('toggle-password'),
};

// --- Auth-aware fetch ---
const originalFetch = window.fetch.bind(window);
window.fetch = function (url, options = {}) {
    const target = typeof url === 'string' ? url : (url && url.url) || '';
    if (state.appPassword && target.startsWith('/api')) {
        const headers = new Headers(options.headers || {});
        headers.set('X-App-Password', state.appPassword);
        return originalFetch(url, { ...options, headers });
    }
    return originalFetch(url, options);
};

function handleUnauthorized(response) {
    if (response.status !== 401) return false;
    state.appPassword = '';
    localStorage.removeItem('appPassword');
    showLogin('Your session expired. Please sign in again.');
    setupLoginEvents();
    return true;
}

// --- Formatting helpers ---

// SQLite CURRENT_TIMESTAMP is UTC but has no timezone suffix. Parsing it as a
// local time shifted every timestamp by the client's offset.
function parseServerDate(value) {
    if (!value) return new Date();
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
        return new Date(`${value.replace(' ', 'T')}Z`);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function formatMessageTime(value) {
    const date = parseServerDate(value);
    const now = new Date();
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (date.toDateString() === now.toDateString()) return time;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

function renderMarkdown(element, text) {
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
        element.textContent = text;
        return;
    }
    try {
        const html = marked.parse(text || '');
        element.innerHTML = DOMPurify.sanitize(html);
    } catch (error) {
        element.textContent = text || '';
    }
}

function newClientId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Builds an SVG reference to a symbol in the inline sprite. Keeping icons as
// DOM nodes avoids HTML string concatenation in the render path.
function iconUse(id, className = 'icon') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${id}`);
    svg.appendChild(use);
    return svg;
}

// --- Button/input state ---

function updateSendButtonState() {
    if (!dom.sendBtn) return;
    if (state.isSending) {
        dom.sendBtn.disabled = false;
        return;
    }
    dom.sendBtn.disabled = !dom.textInput.value.trim() || !state.currentModel;
}

function setSending(sending) {
    state.isSending = sending;
    if (!dom.sendBtn) return;
    dom.sendBtn.classList.toggle('stop', sending);
    dom.sendBtn.innerHTML = sending ? STOP_ICON : SEND_ICON;
    dom.sendBtn.title = sending ? 'Stop generating' : 'Send message';
    dom.sendBtn.setAttribute('aria-label', sending ? 'Stop generating' : 'Send message');
    updateSendButtonState();
}

function autoResizeInput() {
    dom.textInput.style.height = 'auto';
    dom.textInput.style.height = `${dom.textInput.scrollHeight}px`;
}

// --- Clipboard ---

function copyToClipboard(text) {
    return new Promise((resolve, reject) => {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(resolve).catch(reject);
            return;
        }
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(textArea);
            if (ok) resolve();
            else reject(new Error('Copy command failed'));
        } catch (error) {
            reject(error);
        }
    });
}

function addMessageActions(messageDiv, contentEl, msg) {
    if (!messageDiv || messageDiv.querySelector('.message-actions')) return;

    const actions = document.createElement('div');
    actions.className = 'message-actions';

    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = formatMessageTime(msg.created_at);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'copy-msg-btn-clean';
    copyBtn.title = 'Copy message';
    copyBtn.setAttribute('aria-label', 'Copy message');
    copyBtn.innerHTML = COPY_ICON;

    copyBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const clone = contentEl.cloneNode(true);
        clone.querySelectorAll('.message-actions').forEach((node) => node.remove());
        const text = (clone.innerText || clone.textContent || '').trim();
        copyToClipboard(text).then(() => {
            copyBtn.textContent = '✓';
            setTimeout(() => { copyBtn.innerHTML = COPY_ICON; }, 2000);
        }).catch(() => {
            copyBtn.textContent = '✕';
            setTimeout(() => { copyBtn.innerHTML = COPY_ICON; }, 2000);
        });
    });

    if (msg.role === 'user') {
        actions.appendChild(time);
        actions.appendChild(copyBtn);
    } else {
        actions.appendChild(copyBtn);
        actions.appendChild(time);
    }

    // Actions live beside the bubble, never inside it, so copied text stays clean.
    messageDiv.appendChild(actions);
}

// --- Rendering ---

function isNearBottom() {
    const area = dom.chatContainer || dom.messagesArea;
    return area.scrollHeight - area.scrollTop - area.clientHeight < 160;
}

function updateScrollButton() {
    if (!dom.chatContainer || !dom.scrollBottomBtn) return;
    const distance = dom.chatContainer.scrollHeight
        - dom.chatContainer.scrollTop
        - dom.chatContainer.clientHeight;
    dom.scrollBottomBtn.classList.toggle('visible', distance > 160);
}

function scrollToBottom(force = false) {
    const area = dom.chatContainer || dom.messagesArea;
    if (force || isNearBottom()) {
        area.scrollTop = area.scrollHeight;
    }
    updateScrollButton();
}

function appendMessageToUI(msg) {
    const div = document.createElement('div');
    div.className = `message ${msg.role === 'user' ? 'user-msg' : 'assistant-msg'}`;

    if (msg.role !== 'user' && msg.thinking) {
        const thinking = document.createElement('div');
        thinking.className = 'thinking-block' + (dom.thinkingToggle.checked ? ' active' : '');
        thinking.textContent = msg.thinking;
        div.appendChild(thinking);
    }

    const content = document.createElement('div');
    content.className = 'message-content' + (msg.role === 'user' ? '' : ' markdown-body');
    if (msg.role === 'user') content.textContent = msg.content;
    else renderMarkdown(content, msg.content || '');

    div.appendChild(content);
    addMessageActions(div, content, msg);
    dom.messagesArea.appendChild(div);
    scrollToBottom();
    return { div, content };
}

const SUGGESTIONS = [
    'Summarise this in three bullets',
    'Explain it like I am new to the topic',
    'Draft a short, friendly email',
    'Compare the options and recommend one',
];

function showEmptyState() {
    dom.messagesArea.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';

    const mark = document.createElement('div');
    mark.className = 'empty-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.appendChild(iconUse('brand-mark'));

    const kicker = document.createElement('p');
    kicker.className = 'empty-kicker';
    kicker.textContent = 'Ready when you are';

    const title = document.createElement('h2');
    title.textContent = state.currentModel
        ? `Start a conversation using ${state.currentModel}`
        : 'Select a model to start chatting';

    const copy = document.createElement('p');
    copy.className = 'empty-copy';
    copy.textContent = state.currentModel
        ? 'Ask anything, or start with one of these.'
        : 'Choose a model from the header to begin.';

    wrap.appendChild(mark);
    wrap.appendChild(kicker);
    wrap.appendChild(title);
    wrap.appendChild(copy);

    if (state.currentModel) {
        const grid = document.createElement('div');
        grid.className = 'suggestion-grid';
        for (const text of SUGGESTIONS) {
            const suggestion = document.createElement('button');
            suggestion.type = 'button';
            suggestion.className = 'suggestion';
            suggestion.textContent = text;
            suggestion.addEventListener('click', () => {
                dom.textInput.value = text;
                autoResizeInput();
                updateSendButtonState();
                dom.textInput.focus();
            });
            grid.appendChild(suggestion);
        }
        wrap.appendChild(grid);
    }

    dom.messagesArea.appendChild(wrap);
}

function renderMessages() {
    dom.messagesArea.innerHTML = '';
    if (!state.messages.length) {
        showEmptyState();
        return;
    }
    state.messages.forEach((msg) => appendMessageToUI(msg));
    scrollToBottom(true);
}

function renderChatList() {
    dom.chatList.innerHTML = '';
    if (dom.chatCount) dom.chatCount.textContent = String(state.chats.length);
    if (!state.chats.length) {
        const empty = document.createElement('div');
        empty.className = 'chat-list-empty';
        empty.textContent = 'No conversations yet';
        dom.chatList.appendChild(empty);
        return;
    }

    for (const chat of state.chats) {
        const item = document.createElement('div');
        item.className = 'chat-item' + (chat.id === state.currentChatId ? ' active' : '');
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', `Open chat ${chat.title || 'Untitled'}`);

        const title = document.createElement('div');
        title.className = 'chat-item-title';
        title.textContent = chat.title || 'Untitled';

        const date = document.createElement('div');
        date.className = 'chat-item-date';
        date.textContent = parseServerDate(chat.updated_at).toLocaleDateString();

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'delete-chat';
        remove.title = 'Delete chat';
        remove.setAttribute('aria-label', `Delete chat ${chat.title || 'Untitled'}`);
        remove.appendChild(iconUse('icon-trash'));
        remove.addEventListener('click', (event) => {
            event.stopPropagation();
            deleteChat(chat.id);
        });

        const open = () => loadChat(chat.id);
        item.addEventListener('click', open);
        item.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                open();
            }
        });

        item.appendChild(title);
        item.appendChild(date);
        item.appendChild(remove);
        dom.chatList.appendChild(item);
    }
}

function getModelCapabilities(name) {
    const caps = [];
    const normalized = String(name || '').toLowerCase().replace(/[_:]/g, ' ');

    const reasoningKeywords = ['gpt', 'deepseek r1', 'deepseek 3.1', 'deepseek 3.2', 'deepseek v3', 'o1', 'o3', 'reasoning', 'thinking', 'qwq'];
    if (reasoningKeywords.some((keyword) => normalized.includes(keyword))) {
        caps.push({ type: 'thinking', icon: '🧠', label: 'Reasoning' });
    }

    const searchKeywords = ['gpt', 'deepseek 3.1', 'deepseek 3.2', 'qwen 3', 'qwen3', 'search'];
    if (searchKeywords.some((keyword) => normalized.includes(keyword))) {
        caps.push({ type: 'search', icon: '🌐', label: 'Search' });
    }

    if (normalized.includes('llama3') || normalized.includes('mistral')) {
        caps.push({ type: 'tools', icon: '🛠️', label: 'Tools' });
    }

    if (normalized.includes(' 70b') || normalized.includes(' large') || normalized.includes('671b') || normalized.includes('675b') || normalized.includes('480b')) {
        caps.push({ type: 'size', icon: '🏋️', label: 'High Power' });
    } else if (normalized.includes(' 7b') || normalized.includes(' 8b') || normalized.includes('24b') || normalized.includes(' 3b') || normalized.includes(' 4b')) {
        caps.push({ type: 'size', icon: '⚡', label: 'Fast' });
    }

    if (String(name || '').toLowerCase().endsWith('cloud')) {
        caps.push({ type: 'cloud', icon: '☁️', label: 'Cloud' });
    }

    return caps;
}

function renderModelSelect() {
    const modelList = document.getElementById('model-list');
    if (!modelList) return;
    modelList.innerHTML = '';

    const legend = document.createElement('div');
    legend.className = 'caps-legend';
    for (const [icon, label] of [['🧠', 'Reasoning'], ['🌐', 'Search'], ['🛠️', 'Tools'], ['🏋️', 'Heavy'], ['⚡', 'Fast'], ['☁️', 'Cloud']]) {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.textContent = `${icon} ${label}`;
        legend.appendChild(item);
    }
    modelList.appendChild(legend);

    if (!state.models.length) {
        const empty = document.createElement('div');
        empty.className = 'model-empty';
        empty.textContent = 'No models available. Check Ollama or your API key.';
        modelList.appendChild(empty);
        const nameEl = document.getElementById('current-model-name');
        if (nameEl) nameEl.textContent = 'No models';
        updateSettingsForModel('');
        updateSendButtonState();
        return;
    }

    const names = new Set(state.models.map((model) => model.name));
    if (!names.has(state.currentModel)) {
        state.currentModel = state.models[0].name;
        localStorage.setItem('lastModel', state.currentModel);
    }

    let sorted = [...state.models];
    if (sortOrder === 'asc') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortOrder === 'desc') sorted.sort((a, b) => b.name.localeCompare(a.name));

    for (const model of sorted) {
        const option = document.createElement('div');
        option.className = 'model-option' + (model.name === state.currentModel ? ' selected' : '');
        option.dataset.value = model.name;
        option.tabIndex = 0;
        option.setAttribute('role', 'button');
        option.setAttribute('aria-label', `Use model ${model.name}`);

        const info = document.createElement('div');
        info.className = 'model-info';

        const nameRow = document.createElement('div');
        nameRow.className = 'model-name-row';

        const name = document.createElement('span');
        name.className = 'model-name';
        name.textContent = model.name;
        nameRow.appendChild(name);

        if (model.name === state.currentModel) {
            const check = document.createElement('span');
            check.className = 'model-check';
            check.textContent = '✓';
            nameRow.appendChild(check);
        }

        const capabilities = document.createElement('div');
        capabilities.className = 'model-capabilities';
        for (const cap of getModelCapabilities(model.name)) {
            const icon = document.createElement('span');
            icon.className = 'capability-icon';
            icon.title = cap.label;
            icon.textContent = cap.icon;
            capabilities.appendChild(icon);
        }

        info.appendChild(nameRow);
        info.appendChild(capabilities);
        option.appendChild(info);

        const choose = () => selectModel(model.name);
        option.addEventListener('click', choose);
        option.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                choose();
            }
        });

        modelList.appendChild(option);
    }

    const nameEl = document.getElementById('current-model-name');
    if (nameEl) nameEl.textContent = state.currentModel;
    const selector = document.getElementById('model-selector-btn');
    if (selector) selector.title = state.modelsStale ? 'Showing cached model list' : 'Select model';
    updateSettingsForModel(state.currentModel);
    updateSendButtonState();
}

function isModelAvailable(name) {
    return state.models.some((model) => model.name === name);
}

function selectModel(name, { closeModal = true } = {}) {
    if (!isModelAvailable(name)) return;
    state.currentModel = name;
    localStorage.setItem('lastModel', name);

    const nameEl = document.getElementById('current-model-name');
    if (nameEl) nameEl.textContent = name;

    document.querySelectorAll('.model-option').forEach((element) => {
        element.classList.toggle('selected', element.dataset.value === name);
    });

    if (closeModal) closeModelModal();
    updateSettingsForModel(name);
    updateSendButtonState();
}

// --- API calls ---

async function checkStatus() {
    try {
        const response = await fetch('/api/status');
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const data = await response.json();
        state.isConnected = Boolean(data.connected);
        state.mode = typeof data.mode === 'string' ? data.mode : 'local';
        updateStatusUI();
        return data;
    } catch (error) {
        state.isConnected = false;
        updateStatusUI();
        return null;
    }
}

async function verifyPassword() {
    try {
        const response = await fetch('/api/auth/verify');
        return response.ok;
    } catch (error) {
        return false;
    }
}

async function loadModels() {
    try {
        const response = await fetch('/api/models');
        if (handleUnauthorized(response)) return;
        if (!response.ok) {
            state.models = [];
            state.modelsStale = false;
            renderModelSelect();
            return;
        }
        const data = await response.json();
        state.models = (Array.isArray(data.models) ? data.models : [])
            .filter((model) => model && typeof model.name === 'string' && model.name.trim());
        state.modelsStale = Boolean(data.stale);
        renderModelSelect();
    } catch (error) {
        console.error('Failed to load models', error);
        state.models = [];
        renderModelSelect();
    }
}

async function loadChatList() {
    try {
        const response = await fetch('/api/chats');
        if (handleUnauthorized(response)) return;
        if (!response.ok) return;
        const chats = await response.json();
        state.chats = Array.isArray(chats) ? chats : [];
        renderChatList();
    } catch (error) {
        console.error('Failed to load chats', error);
    }
}

async function loadChat(id) {
    abortActiveStream();
    try {
        const response = await fetch(`/api/chats/${id}`);
        if (handleUnauthorized(response)) return;
        if (!response.ok) {
            showGlobalError('Could not open that chat.');
            return;
        }
        const data = await response.json();
        state.currentChatId = data.id;
        state.messages = Array.isArray(data.messages) ? data.messages : [];
        if (data.model && isModelAvailable(data.model)) {
            selectModel(data.model, { closeModal: false });
        }
        renderMessages();
        closeSidebar();
        loadChatList();
    } catch (error) {
        console.error('Failed to load chat', error);
        showGlobalError('Could not open that chat.');
    }
}

function createNewChat() {
    abortActiveStream();
    state.currentChatId = null;
    state.messages = [];
    renderMessages();
    closeSidebar();
    dom.textInput.focus();
}

async function deleteChat(id) {
    if (!window.confirm('Delete this chat?')) return;
    if (state.currentChatId === id) abortActiveStream();
    try {
        const response = await fetch(`/api/chats/${id}`, { method: 'DELETE' });
        if (handleUnauthorized(response)) return;
        if (!response.ok && response.status !== 404) {
            showGlobalError('Could not delete that chat.');
            return;
        }
        if (state.currentChatId === id) {
            state.currentChatId = null;
            state.messages = [];
            renderMessages();
        }
        await loadChatList();
    } catch (error) {
        console.error('Failed to delete chat', error);
        showGlobalError('Could not delete that chat.');
    }
}

// --- Context and streaming ---

function buildContext() {
    const usable = state.messages.filter((message) => (
        message.role !== 'assistant' || (typeof message.content === 'string' && message.content.trim())
    ));

    const context = [];
    let characters = 0;
    for (let i = usable.length - 1; i >= 0; i -= 1) {
        if (context.length >= MAX_CONTEXT_MESSAGES) break;
        const message = usable[i];
        const length = (message.content || '').length;
        if (context.length > 0 && characters + length > MAX_CONTEXT_CHARS) break;
        context.unshift({ role: message.role, content: message.content });
        characters += length;
    }
    return context;
}

function abortActiveStream() {
    if (state.abortController) {
        try { state.abortController.abort(); } catch (error) { /* already aborted */ }
    }
}

function processSseEvent(rawEvent, onEvent) {
    const dataLines = [];
    for (const line of rawEvent.split('\n')) {
        if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).replace(/^ /, ''));
        }
    }
    if (!dataLines.length) return;
    const payload = dataLines.join('\n');
    if (!payload) return;
    let data;
    try {
        data = JSON.parse(payload);
    } catch (error) {
        return;
    }
    onEvent(data);
}

async function consumeSse(stream, onEvent) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let rawEvent = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
                buffer = buffer.slice(newlineIndex + 1);
                if (line === '') {
                    if (rawEvent) {
                        processSseEvent(rawEvent, onEvent);
                        rawEvent = '';
                    }
                } else {
                    rawEvent += `${line}\n`;
                }
            }
        }

        buffer += decoder.decode();
        if (buffer.trim()) rawEvent += buffer;
        if (rawEvent.trim()) processSseEvent(rawEvent, onEvent);
    } finally {
        // Close the stream when the caller throws (for example on an SSE
        // error event) instead of leaving the connection half-open.
        try { await reader.cancel(); } catch (error) { /* already closed */ }
        try { reader.releaseLock(); } catch (error) { /* already released */ }
    }
}

function createStreamingBubble() {
    const div = document.createElement('div');
    div.className = 'message assistant-msg';

    const content = document.createElement('div');
    content.className = 'message-content markdown-body streaming';
    div.appendChild(content);
    dom.messagesArea.appendChild(div);
    scrollToBottom(true);

    return {
        div,
        content,
        thinking: null,
        addThinking(text) {
            if (!this.thinking) {
                this.thinking = document.createElement('div');
                this.thinking.className = 'thinking-block' + (dom.thinkingToggle.checked ? ' active' : '');
                div.insertBefore(this.thinking, content);
            }
            this.thinking.textContent = text;
        },
        warning(message) {
            const warning = document.createElement('div');
            warning.className = 'message-warning';
            warning.textContent = message;
            div.appendChild(warning);
        },
        error(message) {
            const error = document.createElement('div');
            error.className = 'message-error';
            error.textContent = message;
            div.appendChild(error);
        },
    };
}

async function sendMessage() {
    if (state.isSending) return;

    const content = dom.textInput.value.trim();
    if (!content) return;

    if (!state.currentModel) {
        showGlobalError('Select a model before sending a message.');
        return;
    }

    const userMsg = { role: 'user', content, created_at: new Date().toISOString() };
    state.messages.push(userMsg);
    appendMessageToUI(userMsg);

    const history = buildContext();
    const assistantMsg = { role: 'assistant', content: '', thinking: '', created_at: new Date().toISOString() };
    state.messages.push(assistantMsg);

    dom.textInput.value = '';
    autoResizeInput();
    const bubble = createStreamingBubble();
    setSending(true);

    const controller = new AbortController();
    state.abortController = controller;
    const clientMessageId = newClientId();

    const quality = dom.qualitySelect.value;
    const think = dom.thinkingToggle.checked
        ? (quality !== 'none' ? quality : true)
        : undefined;

    const payload = {
        chatId: state.currentChatId,
        model: state.currentModel,
        messages: history,
        clientMessageId,
        options: { web_search: localStorage.getItem('enableSearch') === 'true' },
        think,
    };

    let currentContent = '';
    let currentThinking = '';
    let sawDone = false;

    // Re-rendering the whole Markdown document for every token is O(n²) and
    // makes long replies janky on phones. Coalesce updates to one per frame.
    let renderScheduled = false;
    let pendingText = '';
    const paint = () => {
        renderScheduled = false;
        renderMarkdown(bubble.content, pendingText);
        scrollToBottom();
    };
    const schedulePaint = () => {
        if (renderScheduled) return;
        renderScheduled = true;
        window.requestAnimationFrame(paint);
    };

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        if (handleUnauthorized(response)) {
            throw new Error('Unauthorized');
        }

        if (!response.ok) {
            let message = `Request failed (${response.status})`;
            try {
                const error = await response.json();
                if (error && error.error) message = error.error;
            } catch (error) { /* non-JSON error body */ }
            throw new Error(message);
        }
        if (!response.body) throw new Error('Streaming is not supported by this browser.');

        await consumeSse(response.body, (data) => {
            if (data.type === 'chat_created') {
                state.currentChatId = data.chatId;
                loadChatList();
                return;
            }
            if (data.warning) {
                bubble.warning(data.warning);
                return;
            }
            if (data.error) {
                throw new Error(data.error);
            }
            if (data.message && data.message.thinking) {
                currentThinking += data.message.thinking;
                assistantMsg.thinking = currentThinking;
                bubble.addThinking(currentThinking);
            }
            if (data.message && data.message.content) {
                currentContent += data.message.content;
                assistantMsg.content = currentContent;
                pendingText = currentContent;
                schedulePaint();
            }
            if (data.done) sawDone = true;
        });

        pendingText = currentContent;
        if (currentContent) renderMarkdown(bubble.content, currentContent);

        if (currentContent || currentThinking) {
            addMessageActions(bubble.div, bubble.content, assistantMsg);
        }
        if (!sawDone && (currentContent || currentThinking)) {
            bubble.warning('The connection ended before the reply finished.');
        }
        if (!currentContent && !currentThinking) {
            state.messages = state.messages.filter((message) => message !== assistantMsg);
            bubble.error('No response was received from Ollama.');
        }
    } catch (error) {
        const aborted = error && error.name === 'AbortError';
        pendingText = currentContent;
        if (currentContent) renderMarkdown(bubble.content, currentContent);

        if (currentContent || currentThinking) {
            assistantMsg.content = currentContent;
            assistantMsg.thinking = currentThinking;
            addMessageActions(bubble.div, bubble.content, assistantMsg);
            bubble.warning(aborted ? 'Generation stopped.' : `Error: ${error.message}`);
        } else {
            state.messages = state.messages.filter((message) => message !== assistantMsg);
            if (aborted) {
                bubble.error('Generation stopped.');
            } else if (error && error.message !== 'Unauthorized') {
                bubble.error(`Error: ${error.message}`);
            }
        }
    } finally {
        state.abortController = null;
        bubble.content.classList.remove('streaming');
        setSending(false);
        scrollToBottom();
    }
}

// --- UI status ---

function updateStatusUI() {
    if (!dom.statusIndicator) return;
    dom.statusIndicator.classList.toggle('connected', state.isConnected);
    const label = !state.isConnected
        ? 'Offline'
        : (state.mode === 'cloud' ? 'Cloud' : 'Local');
    dom.statusIndicator.title = state.isConnected ? `Connected · ${label}` : 'Disconnected';
    const text = dom.statusIndicator.querySelector('.status-text');
    if (text) text.textContent = label;
}

function showGlobalError(message) {
    dom.messagesArea.innerHTML = '';
    const error = document.createElement('div');
    error.className = 'message-error global-error';
    error.textContent = message;
    dom.messagesArea.appendChild(error);
    scrollToBottom(true);
}

function showLogin(message = '') {
    if (!dom.loginOverlay) return;
    dom.loginOverlay.style.display = 'flex';
    if (dom.loginError) {
        dom.loginError.textContent = message;
        dom.loginError.style.display = message ? 'block' : 'none';
    }
    if (dom.loginPassword) {
        dom.loginPassword.value = '';
        setTimeout(() => dom.loginPassword.focus(), 50);
    }
}

function hideLogin() {
    if (dom.loginOverlay) dom.loginOverlay.style.display = 'none';
    if (dom.loginError) dom.loginError.style.display = 'none';
}

// --- Sidebar / modals ---

function openSidebar() {
    state.isSidebarOpen = true;
    dom.sidebar.classList.add('open');
    dom.overlay.classList.add('active');
}

function closeSidebar() {
    state.isSidebarOpen = false;
    dom.sidebar.classList.remove('open');
    dom.overlay.classList.remove('active');
}

function closeModelModal() {
    const modal = document.getElementById('model-modal');
    if (modal) modal.classList.remove('active');
    const button = document.getElementById('model-selector-btn');
    if (button) button.setAttribute('aria-expanded', 'false');
}

function closeQualityModal() {
    const modal = document.getElementById('quality-modal');
    if (modal) modal.classList.remove('active');
    const button = document.getElementById('quality-selector-btn');
    if (button) button.setAttribute('aria-expanded', 'false');
}

function setToggleState(button, on) {
    if (!button) return;
    button.classList.toggle('is-on', Boolean(on));
    button.setAttribute('aria-pressed', String(Boolean(on)));
}

function updateSettingsForModel(modelName) {
    const caps = getModelCapabilities(modelName);
    const hasThinking = caps.some((cap) => cap.type === 'thinking');
    const hasSearch = caps.some((cap) => cap.type === 'search');

    const searchBtn = document.getElementById('search-btn');
    const thinkingBtn = document.getElementById('thinking-btn');
    const qualityBtn = document.getElementById('quality-selector-btn');

    if (searchBtn) {
        searchBtn.hidden = !hasSearch;
        setToggleState(searchBtn, localStorage.getItem('enableSearch') === 'true');
    }
    if (thinkingBtn) {
        thinkingBtn.hidden = !hasThinking;
        setToggleState(thinkingBtn, dom.thinkingToggle.checked);
    }
    if (qualityBtn) {
        qualityBtn.hidden = !hasThinking;
        const quality = dom.qualitySelect ? dom.qualitySelect.value : 'none';
        qualityBtn.classList.toggle('is-on', quality !== 'none');
    }

    // Keep the full tools row out of the layout when no chip applies, without
    // relying on :has() support.
    const tools = document.getElementById('composer-tools');
    if (tools) {
        const anyVisible = [searchBtn, thinkingBtn, qualityBtn].some((btn) => btn && !btn.hidden);
        tools.hidden = !anyVisible;
    }

    // The empty state names the active model, so refresh it on model changes.
    if (!state.messages.length) showEmptyState();
}

// --- Theme ---

const THEME_ORDER = ['auto', 'light', 'dark'];
const THEME_LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const THEME_ICONS = { auto: '◐', light: '☀', dark: '☾' };

function applyTheme(theme) {
    const next = THEME_ORDER.includes(theme) ? theme : 'auto';
    if (next === 'auto') {
        delete document.documentElement.dataset.theme;
    } else {
        document.documentElement.dataset.theme = next;
    }

    const toggle = dom.themeToggle || document.getElementById('theme-toggle');
    if (!toggle) return;
    const label = toggle.querySelector('.theme-label');
    const icon = toggle.querySelector('.theme-icon');
    if (label) label.textContent = THEME_LABELS[next];
    if (icon) icon.textContent = THEME_ICONS[next];
    toggle.setAttribute('aria-label', `Theme: ${THEME_LABELS[next].toLowerCase()}. Change theme`);
}

function cycleTheme() {
    const current = localStorage.getItem('theme') || 'auto';
    const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
    localStorage.setItem('theme', next);
    applyTheme(next);
}

function setFontSize(size) {
    const sizes = { small: '14px', medium: '16px', large: '18px' };
    document.documentElement.style.fontSize = sizes[size] || sizes.medium;
    localStorage.setItem('fontSize', size);
    document.querySelectorAll('.font-btn').forEach((button) => {
        button.classList.toggle('active', button.dataset.size === size);
    });
}

function setQualityPreset(value) {
    if (dom.qualitySelect) {
        dom.qualitySelect.value = value;
        localStorage.setItem('qualityPreset', value);
        const labels = { none: 'Std', low: 'Low', medium: 'Med', high: 'High' };
        const nameEl = document.getElementById('current-quality-name');
        if (nameEl) nameEl.textContent = labels[value] || 'Std';
    }
    document.querySelectorAll('#quality-modal [data-quality]').forEach((element) => {
        element.classList.toggle('selected', element.dataset.quality === value);
    });
    const qualityBtn = document.getElementById('quality-selector-btn');
    if (qualityBtn) qualityBtn.classList.toggle('is-on', value !== 'none');
    closeQualityModal();
}

// --- Init ---

let eventsBound = false;

function setupEventListeners() {
    if (eventsBound) return;
    eventsBound = true;

    dom.menuBtn.addEventListener('click', openSidebar);
    dom.closeSidebarBtn.addEventListener('click', closeSidebar);
    dom.overlay.addEventListener('click', () => {
        closeSidebar();
        closeModelModal();
        closeQualityModal();
    });
    dom.newChatBtn.addEventListener('click', createNewChat);

    if (dom.chatContainer) {
        dom.chatContainer.addEventListener('scroll', updateScrollButton, { passive: true });
    }
    if (dom.scrollBottomBtn) {
        dom.scrollBottomBtn.addEventListener('click', () => scrollToBottom(true));
    }
    if (dom.themeToggle) {
        dom.themeToggle.addEventListener('click', cycleTheme);
    }

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        closeModelModal();
        closeQualityModal();
        if (state.isSidebarOpen) closeSidebar();
    });

    const headerNewChatBtn = document.getElementById('header-new-chat-btn');
    if (headerNewChatBtn) headerNewChatBtn.addEventListener('click', createNewChat);

    const modelSelectorBtn = document.getElementById('model-selector-btn');
    const modelModal = document.getElementById('model-modal');
    if (modelSelectorBtn && modelModal) {
        modelSelectorBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            modelModal.classList.add('active');
            modelSelectorBtn.setAttribute('aria-expanded', 'true');
            renderModelSelect();
        });
    }

    const closeModalBtn = document.getElementById('close-model-modal');
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModelModal);

    const sortDefault = document.getElementById('sort-default');
    const sortAz = document.getElementById('sort-az');
    if (sortDefault) {
        sortDefault.addEventListener('click', () => {
            sortOrder = 'default';
            sortDefault.classList.add('active');
            if (sortAz) sortAz.classList.remove('active');
            renderModelSelect();
        });
    }
    if (sortAz) sortAz.addEventListener('click', toggleSort);

    document.addEventListener('click', (event) => {
        if (modelModal && modelModal.classList.contains('active')
            && !modelModal.querySelector('.model-modal-content').contains(event.target)
            && modelSelectorBtn && !modelSelectorBtn.contains(event.target)) {
            closeModelModal();
        }
        const qualityModal = document.getElementById('quality-modal');
        const qualitySelectorBtn = document.getElementById('quality-selector-btn');
        if (qualityModal && qualityModal.classList.contains('active')
            && !qualityModal.querySelector('.model-modal-content').contains(event.target)
            && qualitySelectorBtn && !qualitySelectorBtn.contains(event.target)) {
            closeQualityModal();
        }
    });

    if (dom.qualitySelect) {
        dom.qualitySelect.addEventListener('change', (event) => {
            localStorage.setItem('qualityPreset', event.target.value);
        });
    }

    const thinkingBtn = document.getElementById('thinking-btn');
    if (thinkingBtn) {
        thinkingBtn.addEventListener('click', () => {
            dom.thinkingToggle.checked = !dom.thinkingToggle.checked;
            dom.thinkingToggle.dispatchEvent(new Event('change'));
        });
    }

    dom.thinkingToggle.addEventListener('change', (event) => {
        localStorage.setItem('showThinking', event.target.checked);
        const thinkingBtnEl = document.getElementById('thinking-btn');
        setToggleState(thinkingBtnEl, event.target.checked);
        document.querySelectorAll('.thinking-block').forEach((element) => {
            element.classList.toggle('active', event.target.checked);
        });
    });

    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            const next = localStorage.getItem('enableSearch') !== 'true';
            localStorage.setItem('enableSearch', String(next));
            setToggleState(searchBtn, next);
        });
    }

    const qualitySelectorBtn = document.getElementById('quality-selector-btn');
    const qualityModal = document.getElementById('quality-modal');
    if (qualitySelectorBtn && qualityModal) {
        qualitySelectorBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            qualityModal.classList.add('active');
            qualitySelectorBtn.setAttribute('aria-expanded', 'true');
        });
    }
    const closeQualityBtn = document.getElementById('close-quality-modal');
    if (closeQualityBtn && qualityModal) {
        closeQualityBtn.addEventListener('click', closeQualityModal);
    }
    document.querySelectorAll('#quality-modal [data-quality]').forEach((element) => {
        const apply = () => setQualityPreset(element.dataset.quality);
        element.addEventListener('click', apply);
        element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                apply();
            }
        });
    });

    dom.sendBtn.addEventListener('click', () => {
        if (state.isSending) {
            abortActiveStream();
        } else {
            sendMessage();
        }
    });

    dom.textInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (!state.isSending) sendMessage();
        }
    });

    dom.textInput.addEventListener('input', () => {
        autoResizeInput();
        updateSendButtonState();
    });

    document.querySelectorAll('.font-btn').forEach((button) => {
        button.addEventListener('click', () => setFontSize(button.dataset.size));
    });

    if (window.visualViewport) {
        let scheduled = false;
        window.visualViewport.addEventListener('resize', () => {
            if (scheduled) return;
            scheduled = true;
            window.requestAnimationFrame(() => {
                scheduled = false;
                if (!dom.app || !window.visualViewport.height) return;
                dom.app.style.height = `${window.visualViewport.height}px`;
                scrollToBottom();
            });
        });
    }
}

let sortOrder = 'default';

function toggleSort() {
    sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    const sortDefault = document.getElementById('sort-default');
    const sortAz = document.getElementById('sort-az');
    if (sortDefault) sortDefault.classList.remove('active');
    if (sortAz) {
        sortAz.classList.add('active');
        const svg = sortAz.querySelector('svg');
        if (svg) svg.style.transform = sortOrder === 'asc' ? 'rotate(0deg)' : 'rotate(180deg)';
    }
    renderModelSelect();
}

let loginBound = false;

function setupLoginEvents() {
    if (loginBound) return;
    loginBound = true;

    if (dom.loginBtn) dom.loginBtn.addEventListener('click', handleLogin);
    if (dom.loginPassword) {
        dom.loginPassword.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') handleLogin();
        });
    }
    if (dom.togglePassword) {
        dom.togglePassword.addEventListener('click', () => {
            const show = dom.loginPassword.getAttribute('type') === 'password';
            dom.loginPassword.setAttribute('type', show ? 'text' : 'password');
            const eyeIcon = document.getElementById('eye-icon');
            if (eyeIcon) {
                eyeIcon.style.opacity = show ? '0.5' : '1';
            }
        });
    }
}

async function handleLogin() {
    if (!dom.loginPassword) return;
    const password = dom.loginPassword.value;
    if (!password) {
        showLogin('Enter your password.');
        return;
    }

    if (dom.loginBtn) {
        dom.loginBtn.disabled = true;
        dom.loginBtn.textContent = 'Connecting...';
    }

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-App-Password': password },
            body: JSON.stringify({ password }),
        });

        if (response.ok) {
            state.appPassword = password;
            localStorage.setItem('appPassword', password);
            hideLogin();
            await completeInit();
        } else if (response.status === 429) {
            showLogin('Too many attempts. Wait a minute and try again.');
        } else {
            showLogin('Invalid password.');
        }
    } catch (error) {
        showLogin('Could not reach the server.');
    } finally {
        if (dom.loginBtn) {
            dom.loginBtn.disabled = false;
            dom.loginBtn.textContent = 'Connect';
        }
    }
}

async function completeInit() {
    if (!state.initialized) {
        state.initialized = true;
        setupEventListeners();

        const savedQuality = localStorage.getItem('qualityPreset');
        if (savedQuality && dom.qualitySelect) setQualityPreset(savedQuality);

        const savedThinking = localStorage.getItem('showThinking');
        if (savedThinking !== null) {
            dom.thinkingToggle.checked = savedThinking === 'true';
            setToggleState(document.getElementById('thinking-btn'), dom.thinkingToggle.checked);
        }

        const searchOn = localStorage.getItem('enableSearch') === 'true';
        const searchBtn = document.getElementById('search-btn');
        if (searchBtn) setToggleState(searchBtn, searchOn);

        setFontSize(localStorage.getItem('fontSize') || 'medium');
    }

    await loadModels();
    await loadChatList();
    if (!state.messages.length) renderMessages();
    updateSendButtonState();
}

async function init() {
    applyTheme(localStorage.getItem('theme') || 'auto');
    const status = await checkStatus();

    if (!status) {
        showLogin('Could not reach the server. Retry once it is running.');
        setupLoginEvents();
        return;
    }

    if (status.authRequired) {
        if (state.appPassword) {
            const valid = await verifyPassword();
            if (!valid) {
                state.appPassword = '';
                localStorage.removeItem('appPassword');
                showLogin('The saved password was rejected. Please sign in again.');
                setupLoginEvents();
                return;
            }
        } else {
            showLogin();
            setupLoginEvents();
            return;
        }
    }

    await completeInit();
}

init();
