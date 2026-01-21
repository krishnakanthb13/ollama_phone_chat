// --- State ---
const state = {
    currentChatId: null,
    currentModel: localStorage.getItem('lastModel') || '',
    chats: [],
    messages: [],
    isSidebarOpen: false,
    isConnected: false,
    isSending: false, // Track sending state
    models: []
};

// ... (DOM elements)

// ...

// Helper to manage button state
function updateSendButtonState() {
    if (state.isSending) {
        dom.sendBtn.disabled = true;
        return;
    }
    const hasText = dom.textInput && dom.textInput.value.trim().length > 0;
    if (dom.sendBtn) dom.sendBtn.disabled = !hasText;
}

// --- Robust Copy Helper for Android/iOS ---
function copyToClipboard(text) {
    return new Promise((resolve, reject) => {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(resolve).catch(reject);
        } else {
            // Fallback for non-HTTPS or older mobile browsers
            try {
                const textArea = document.createElement("textarea");
                textArea.value = text;
                // Ensure it's not visible but part of DOM
                textArea.style.position = "fixed";
                textArea.style.left = "-999999px";
                textArea.style.top = "-999999px";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                if (successful) resolve();
                else reject(new Error('Copy command failed'));
            } catch (err) {
                reject(err);
            }
        }
    });
}

function addMessageActions(container, msg) {
    if (container.querySelector('.message-actions')) return;

    const actions = document.createElement('div');
    actions.className = 'message-actions';

    // Date & Time Logic
    const date = msg.created_at ? new Date(msg.created_at) : new Date();
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    let displayStr = '';
    if (isToday) {
        displayStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
        // Shown as "Jan 21, 14:30"
        displayStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' +
            date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = displayStr;

    // Copy Button
    const btn = document.createElement('button');
    btn.className = 'copy-msg-btn-clean';
    btn.title = 'Copy';
    btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor">
       <path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/>
    </svg>`;

    btn.onclick = function (e) {
        e.stopPropagation();
        const clone = container.cloneNode(true);
        const b = clone.querySelector('.message-actions');
        if (b) b.remove();
        const text = clone.innerText.trim();

        copyToClipboard(text).then(() => {
            const original = btn.innerHTML;
            btn.innerHTML = '<span style="font-size: 1.1rem; font-weight: bold;">✓</span>';
            setTimeout(() => {
                btn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor">
                   <path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/>
                </svg>`;
            }, 2000);
        });
    };

    // Align based on role
    if (msg.role === 'user') {
        actions.appendChild(timeSpan);
        actions.appendChild(btn);
    } else {
        actions.appendChild(btn);
        actions.appendChild(timeSpan);
    }

    container.appendChild(actions);
}

async function sendMessage() {
    const content = dom.textInput.value.trim();
    if (!content || state.isSending) return;

    state.isSending = true;
    updateSendButtonState();

    // Add user message to UI immediately
    const userMsg = { role: 'user', content, created_at: new Date().toISOString() };
    state.messages.push(userMsg);
    appendMessageToUI(userMsg);

    dom.textInput.value = '';
    dom.textInput.style.height = 'auto';

    // Prepare assistant message container
    const assistantMsgId = Date.now();
    const assistantMsg = { role: 'assistant', content: '', thinking: '', created_at: new Date().toISOString() };
    state.messages.push(assistantMsg); // Placeholder

    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant-msg';
    msgDiv.id = `msg-${assistantMsgId}`;
    dom.messagesArea.appendChild(msgDiv);

    // Streaming Logic
    try {
        const payload = {
            chatId: state.currentChatId,
            model: state.currentModel,
            messages: state.messages.slice(0, -1),
            options: {
                web_search: localStorage.getItem('enableSearch') === 'true'
            },
            think: dom.qualitySelect.value !== 'none' ? dom.qualitySelect.value : undefined
        };

        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentThinking = '';
        let currentContent = '';

        let thinkingBlock = null;
        let contentBlock = document.createElement('div');
        contentBlock.className = 'message-content markdown-body';
        msgDiv.appendChild(contentBlock);

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.trim().startsWith('data: ')) {
                    const jsonStr = line.replace('data: ', '').trim();
                    if (!jsonStr) continue;

                    try {
                        const data = JSON.parse(jsonStr);

                        if (data.type === 'chat_created') {
                            state.currentChatId = data.chatId;
                            loadChatList();
                            continue;
                        }

                        if (data.error) {
                            contentBlock.innerHTML += `<div class="error">Error: ${data.error}</div>`;
                            continue;
                        }

                        if (data.message?.thinking) {
                            if (!thinkingBlock) {
                                thinkingBlock = document.createElement('div');
                                thinkingBlock.className = 'thinking-block ' + (dom.thinkingToggle.checked ? 'active' : '');
                                msgDiv.insertBefore(thinkingBlock, contentBlock);
                            }
                            currentThinking += data.message.thinking;
                            thinkingBlock.textContent = currentThinking;
                            assistantMsg.thinking = currentThinking;
                        }

                        if (data.message?.content) {
                            currentContent += data.message.content;
                            contentBlock.innerHTML = DOMPurify.sanitize(marked.parse(currentContent));
                            assistantMsg.content = currentContent;
                        }

                        dom.messagesArea.scrollTop = dom.messagesArea.scrollHeight;

                    } catch (e) {
                        console.error("Error parsing stream", e);
                    }
                }
            }
        }

        // --- ADD ACTIONS AFTER STREAMING ---
        addMessageActions(contentBlock, assistantMsg);

    } catch (e) {
        console.error("Send failed", e);
    } finally {
        state.isSending = false;
        updateSendButtonState();
    }
}

// --- DOM Elements ---
const dom = {
    app: document.getElementById('app'),
    sidebar: document.getElementById('sidebar'),
    overlay: document.getElementById('overlay'),
    menuBtn: document.getElementById('menu-btn'),
    closeSidebarBtn: document.getElementById('close-sidebar-btn'),
    chatList: document.getElementById('chat-list'),
    newChatBtn: document.getElementById('new-chat-btn'),
    modelSelect: document.getElementById('model-select'),
    statusIndicator: document.getElementById('status-indicator'),
    messagesArea: document.getElementById('messages-area'),
    textInput: document.getElementById('user-input'),
    sendBtn: document.getElementById('send-btn'),
    qualitySelect: document.getElementById('quality-select'),
    thinkingToggle: document.getElementById('thinking-toggle')
};

// --- Initialization ---
async function init() {
    checkStatus();
    await loadModels();
    await loadChatList();

    setupEventListeners();

    const savedQuality = localStorage.getItem('qualityPreset');
    if (savedQuality) {
        dom.qualitySelect.value = savedQuality;
        const labels = { 'none': 'Std', 'low': 'Low', 'medium': 'Med', 'high': 'High' };
        const nameEl = document.getElementById('current-quality-name');
        if (nameEl) nameEl.textContent = labels[savedQuality] || 'Std';
    }

    const savedThinking = localStorage.getItem('showThinking');
    if (savedThinking !== null) {
        dom.thinkingToggle.checked = (savedThinking === 'true');

        // Sync button visual if exists
        const thinkingBtn = document.getElementById('thinking-btn');
        if (thinkingBtn) {
            thinkingBtn.style.backgroundColor = (savedThinking === 'true') ? 'var(--accent)' : 'var(--bg-tertiary)';
            thinkingBtn.style.color = (savedThinking === 'true') ? 'white' : 'var(--text-secondary)';
        }
    }

    // Search Toggle Init (Default OFF)
    const savedSearch = localStorage.getItem('enableSearch');
    // Default to false if not set
    const isSearchOn = savedSearch === 'true';
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        searchBtn.style.backgroundColor = isSearchOn ? 'var(--accent)' : 'var(--bg-tertiary)';
        searchBtn.style.color = isSearchOn ? 'white' : 'var(--text-secondary)';
    }
}

// --- API Calls ---
async function checkStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        state.isConnected = data.connected;
        updateStatusUI();
    } catch (e) {
        state.isConnected = false;
        updateStatusUI();
    }
}

async function loadModels() {
    try {
        const res = await fetch('/api/models');
        const data = await res.json();
        // Support standard Ollama response structure { models: [...] }
        const allModels = data.models || [];
        // Filter: Only consider models dealing with 'cloud'
        state.models = allModels.filter(m => m.name.toLowerCase().endsWith('cloud'));
        renderModelSelect();
    } catch (e) {
        console.error("Failed to load models", e);
    }
}

async function loadChatList() {
    try {
        const res = await fetch('/api/chats');
        state.chats = await res.json();
        renderChatList();
    } catch (e) {
        console.error("Failed to load chats", e);
    }
}

async function loadChat(id) {
    try {
        const res = await fetch(`/api/chats/${id}`);
        const data = await res.json();
        state.currentChatId = data.id;
        state.messages = data.messages || [];
        // If chat has a specific model, switch to it, otherwise keep current
        if (data.model && isModelAvailable(data.model)) {
            setModel(data.model);
        }
        renderMessages();
        closeSidebar();
    } catch (e) {
        console.error("Failed to load chat", e);
    }
}

async function createNewChat() {
    state.currentChatId = null;
    state.messages = [];
    renderMessages();
    closeSidebar();
    dom.textInput.focus();
}

async function deleteChat(e, id) {
    e.stopPropagation();
    if (!confirm('Delete this chat?')) return;

    try {
        await fetch(`/api/chats/${id}`, { method: 'DELETE' });
        if (state.currentChatId === id) createNewChat();
        await loadChatList();
    } catch (e) {
        console.error("Failed to delete chat", e);
    }
}

async function sendMessage() {
    const content = dom.textInput.value.trim();
    if (!content) return;

    // Add user message to UI immediately
    const userMsg = { role: 'user', content };
    state.messages.push(userMsg);
    appendMessageToUI(userMsg);

    dom.textInput.value = '';
    dom.textInput.style.height = 'auto';
    dom.sendBtn.disabled = true;

    // Prepare assistant message container
    const assistantMsgId = Date.now();
    const assistantMsg = { role: 'assistant', content: '', thinking: '' };
    state.messages.push(assistantMsg); // Placeholder

    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant-msg';
    msgDiv.id = `msg-${assistantMsgId}`;
    dom.messagesArea.appendChild(msgDiv);

    // Streaming Logic
    try {
        const payload = {
            chatId: state.currentChatId,
            model: state.currentModel,
            messages: state.messages.slice(0, -1), // Send history excluding the empty assistant placeholder
            options: {
                // Pass search capability if enabled
                web_search: localStorage.getItem('enableSearch') === 'true'
            },
            think: dom.qualitySelect.value !== 'none' ? dom.qualitySelect.value : undefined
        };

        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentThinking = '';
        let currentContent = '';

        // Create UI structure for thinking and content
        let thinkingBlock = null;
        let contentBlock = document.createElement('div');
        contentBlock.className = 'message-content markdown-body';
        msgDiv.appendChild(contentBlock);

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep partial line

            for (const line of lines) {
                if (line.trim().startsWith('data: ')) {
                    const jsonStr = line.replace('data: ', '').trim();
                    if (!jsonStr) continue;

                    try {
                        const data = JSON.parse(jsonStr);

                        // Handle chat creation event
                        if (data.type === 'chat_created') {
                            state.currentChatId = data.chatId;
                            loadChatList(); // Refresh sidebar list
                            continue;
                        }

                        if (data.error) {
                            contentBlock.innerHTML += `<div class="error">Error: ${data.error}</div>`;
                            continue;
                        }

                        // Handle Thinking
                        if (data.message?.thinking) {
                            if (!thinkingBlock) {
                                thinkingBlock = document.createElement('div');
                                thinkingBlock.className = 'thinking-block ' + (dom.thinkingToggle.checked ? 'active' : '');
                                msgDiv.insertBefore(thinkingBlock, contentBlock);
                            }
                            currentThinking += data.message.thinking;
                            thinkingBlock.textContent = currentThinking;
                            assistantMsg.thinking = currentThinking;
                        }

                        // Handle Content
                        if (data.message?.content) {
                            currentContent += data.message.content;
                            contentBlock.innerHTML = DOMPurify.sanitize(marked.parse(currentContent));
                            assistantMsg.content = currentContent;
                        }

                        dom.messagesArea.scrollTop = dom.messagesArea.scrollHeight;

                    } catch (e) {
                        console.error("Error parsing stream", e);
                    }
                }
            }
        }

        dom.sendBtn.disabled = false;

    } catch (e) {
        console.error("Send failed", e);
        dom.sendBtn.disabled = false;
    }
}

// --- UI Rendering ---

function updateStatusUI() {
    if (state.isConnected) {
        dom.statusIndicator.classList.add('connected');
    } else {
        dom.statusIndicator.classList.remove('connected');
    }
}

// function renderModelSelect() { ... } // Duplicate removed

function renderChatList() {
    dom.chatList.innerHTML = state.chats.map(chat => `
    <div class="chat-item ${chat.id === state.currentChatId ? 'active' : ''}" onclick="loadChat(${chat.id})">
      <div class="chat-item-title">${chat.title}</div>
      <div class="chat-item-date">${new Date(chat.updated_at).toLocaleDateString()}</div>
      <span class="delete-chat" onclick="deleteChat(event, ${chat.id})">🗑️</span>
    </div>
  `).join('');
}

function renderMessages() {
    dom.messagesArea.innerHTML = '';
    if (state.messages.length === 0) {
        dom.messagesArea.innerHTML = `
        <div class="message assistant-msg" style="opacity: 0.5; text-align: center; margin-top: 2rem;">
          <div class="message-content">Start a conversation using ${state.currentModel || 'Ollama'}</div>
        </div>`;
        return;
    }

    state.messages.forEach(msg => appendMessageToUI(msg));
    setTimeout(() => dom.messagesArea.scrollTop = dom.messagesArea.scrollHeight, 100);
}

function appendMessageToUI(msg) {
    const div = document.createElement('div');
    div.className = `message ${msg.role === 'user' ? 'user-msg' : 'assistant-msg'}`;

    let contentHtml = '';

    // 1. Header (Role Label) - Minimal structure

    // 2. Content Body
    let contentEl = document.createElement('div');
    contentEl.className = 'message-content';
    if (msg.role !== 'user') contentEl.classList.add('markdown-body');

    if (msg.role === 'user') {
        contentEl.textContent = msg.content;
    } else {
        contentEl.innerHTML = DOMPurify.sanitize(marked.parse(msg.content));
    }

    // --- ADD ACTIONS (Time + Copy) ---
    addMessageActions(contentEl, msg);

    // 4. Thinking Logic
    let thinkingHtml = '';
    if (msg.role !== 'user' && msg.thinking) {
        thinkingHtml = `<div class="thinking-block ${dom.thinkingToggle.checked ? 'active' : ''}">${msg.thinking}</div>`;
    }

    div.innerHTML = thinkingHtml; // Add thinking first
    div.appendChild(contentEl);   // Append the content element with button inside

    dom.messagesArea.appendChild(div);
    if (!state.isSending) dom.messagesArea.scrollTop = dom.messagesArea.scrollHeight;
}

// --- Helpers ---
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

function setModel(name) {
    state.currentModel = name;
    localStorage.setItem('lastModel', name);
    // dom.modelSelect.value = name; // Removed legacy select

    // Update UI
    const nameEl = document.getElementById('current-model-name');
    if (nameEl) nameEl.textContent = name;

    // Update modal selection state
    document.querySelectorAll('.model-option').forEach(el => {
        if (el.dataset.value === name) el.classList.add('selected');
        else el.classList.remove('selected');
    });

    closeModelModal();
    updateSettingsForModel(name);
}

function isModelAvailable(name) {
    return state.models.some(m => m.name === name);
}

// --- Event Listeners ---
function setupEventListeners() {
    // Sidebar
    dom.menuBtn.addEventListener('click', openSidebar);
    dom.closeSidebarBtn.addEventListener('click', closeSidebar);
    dom.overlay.addEventListener('click', () => { closeSidebar(); closeModelModal(); });
    dom.newChatBtn.addEventListener('click', createNewChat);

    // Header New Chat Button
    const headerNewChatBtn = document.getElementById('header-new-chat-btn');
    if (headerNewChatBtn) headerNewChatBtn.addEventListener('click', createNewChat);

    // Custom Model Selector Toggle
    const modelSelectorBtn = document.getElementById('model-selector-btn');
    const modelModal = document.getElementById('model-modal');

    modelSelectorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modelModal.classList.add('active'); // Changed to add class for fullscreen
        renderModelSelect(); // Re-render to ensure sort is applied
    });

    // Modal Close Button
    const closeModalBtn = document.getElementById('close-model-modal');
    if (closeModalBtn) closeModalBtn.addEventListener('click', () => closeModelModal());

    // Sort Buttons
    const sortDefault = document.getElementById('sort-default');
    const sortAz = document.getElementById('sort-az');

    if (sortDefault) sortDefault.addEventListener('click', () => {
        sortOrder = 'default';
        sortDefault.classList.add('active');
        sortAz.classList.remove('active');
        renderModelSelect();
    });

    if (sortAz) sortAz.addEventListener('click', toggleSort);

    // Close modals when clicking elsewhere
    document.addEventListener('click', (e) => {
        if (modelModal.classList.contains('active') && !modelModal.querySelector('.model-modal-content').contains(e.target) && !modelSelectorBtn.contains(e.target)) {
            closeModelModal();
        }
        if (qualityModal.classList.contains('active') && !qualityModal.querySelector('.model-modal-content').contains(e.target) && !qualitySelectorBtn.contains(e.target)) {
            qualityModal.classList.remove('active');
        }
    });

    // Settings
    dom.qualitySelect.addEventListener('change', (e) => {
        localStorage.setItem('qualityPreset', e.target.value);
    });

    const thinkingBtn = document.getElementById('thinking-btn');
    if (thinkingBtn) {
        thinkingBtn.addEventListener('click', () => {
            const toggle = dom.thinkingToggle;
            toggle.checked = !toggle.checked;
            toggle.dispatchEvent(new Event('change')); // Trigger original logic

            // Update button visual
            thinkingBtn.style.backgroundColor = toggle.checked ? 'var(--accent)' : 'var(--bg-tertiary)';
            thinkingBtn.style.color = toggle.checked ? 'white' : 'var(--text-secondary)';
        });
    }

    dom.thinkingToggle.addEventListener('change', (e) => {
        localStorage.setItem('showThinking', e.target.checked);
        document.querySelectorAll('.thinking-block').forEach(el => {
            if (e.target.checked) el.classList.add('active');
            else el.classList.remove('active');
        });
    });

    // Search Button Listener
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            const currentState = localStorage.getItem('enableSearch') === 'true';
            const newState = !currentState;
            localStorage.setItem('enableSearch', newState);

            // Update visual
            searchBtn.style.backgroundColor = newState ? 'var(--accent)' : 'var(--bg-tertiary)';
            searchBtn.style.color = newState ? 'white' : 'var(--text-secondary)';
        });
    }

    // Custom Quality Selector
    const qualitySelectorBtn = document.getElementById('quality-selector-btn');
    const qualityModal = document.getElementById('quality-modal');
    if (qualitySelectorBtn) {
        qualitySelectorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            qualityModal.classList.add('active');
        });
    }

    const closeQualityBtn = document.getElementById('close-quality-modal');
    if (closeQualityBtn) {
        closeQualityBtn.addEventListener('click', () => {
            qualityModal.classList.remove('active');
        });
    }

    // Chat
    dom.sendBtn.addEventListener('click', sendMessage);
    dom.textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    dom.textInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        updateSendButtonState();
    });

    window.loadChat = loadChat;
    window.deleteChat = deleteChat;
    window.setQualityPreset = setQualityPreset;
}

function setQualityPreset(value) {
    if (dom.qualitySelect) {
        dom.qualitySelect.value = value;
        localStorage.setItem('qualityPreset', value);

        // Update header UI
        const labels = { 'none': 'Std', 'low': 'Low', 'medium': 'Med', 'high': 'High' };
        const nameEl = document.getElementById('current-quality-name');
        if (nameEl) nameEl.textContent = labels[value] || 'Std';
    }

    // Close modal
    const qualityModal = document.getElementById('quality-modal');
    if (qualityModal) qualityModal.classList.remove('active');
}

// --- Helpers ---
function closeModelModal() {
    const modelModal = document.getElementById('model-modal');
    if (modelModal) modelModal.classList.remove('active');
}

// Duplicate setModel removed

function updateSettingsForModel(modelName) {
    const caps = getModelCapabilities(modelName);
    const hasThinking = caps.some(c => c.type === 'thinking');
    const hasSearch = caps.some(c => c.type === 'search');

    // UI Elements
    const headerControls = document.getElementById('header-controls');
    const searchBtn = document.getElementById('search-btn');
    const thinkingBtn = document.getElementById('thinking-btn');
    const qualityBtn = document.getElementById('quality-selector-btn');

    if (headerControls) {
        // ALWAYS show container, but hide children
        headerControls.style.display = 'flex';

        // 1. Search Button Logic
        if (searchBtn) {
            searchBtn.style.display = hasSearch ? 'flex' : 'none';
        }

        // 2. Thinking Button Logic
        if (thinkingBtn) {
            thinkingBtn.style.display = hasThinking ? 'flex' : 'none';
            // Visual state update
            const isThinking = localStorage.getItem('showThinking') === 'true';
            thinkingBtn.style.backgroundColor = isThinking ? 'var(--accent)' : 'var(--bg-tertiary)';
            thinkingBtn.style.color = isThinking ? 'white' : 'var(--text-secondary)';
        }

        // 3. Quality Selector Logic (tied to Thinking)
        if (qualityBtn) {
            qualityBtn.style.display = hasThinking ? 'flex' : 'none';
        }
    }
}
// Removed updateHeaderCapabilities as controls are now interactive in header

let sortOrder = 'default'; // 'default', 'asc', or 'desc'

function toggleSort() {
    sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';

    // Update active state
    document.getElementById('sort-default').classList.remove('active');
    const sortAz = document.getElementById('sort-az');
    sortAz.classList.add('active');

    // Update arrow direction
    sortAz.querySelector('svg').style.transform = sortOrder === 'asc' ? 'rotate(0deg)' : 'rotate(180deg)';

    renderModelSelect();
}

function getModelCapabilities(name) {
    const caps = [];
    const lower = name.toLowerCase();

    // 1. Thinking / Reasoning Support (🧠)
    // Keywords from user: gpt, deepseek 3.1 671b, plus original heuristics
    const reasoningKeywords = ['gpt', 'deepseek-r1', 'deepseek 3.1', 'o1', 'reasoning'];
    if (reasoningKeywords.some(kw => lower.includes(kw))) {
        // Exception: Explicit "none" models from user list
        const isNone = ['ministral', 'nemotron', 'kimi', 'gemma', 'gemini 3', 'glm', 'cogito', 'rnj'].some(kw => lower.includes(kw));
        if (!isNone || lower.includes('thinking')) { // Keep if name explicitly says thinking
            caps.push({ type: 'thinking', icon: '🧠', label: 'Thinking' });
        }
    }

    // 2. Web Search Support (🌐)
    // Keywords from user: gpt, deepseek 3.1, deepseek 3.2, qwen 3, qwen3
    const searchKeywords = ['gpt', 'deepseek 3.1', 'deepseek 3.2', 'qwen 3', 'qwen3'];
    if (searchKeywords.some(kw => lower.includes(kw))) {
        caps.push({ type: 'search', icon: '🌐', label: 'Search' });
    }

    // 3. Tools Support (🛠️) - Modern generic models
    if (lower.includes('llama3') || lower.includes('mistral')) {
        caps.push({ type: 'tools', icon: '🛠️', label: 'Tools' });
    }

    // 4. Size / Power (🏋️ vs ⚡)
    if (lower.includes(':70b') || lower.includes(':large') || lower.includes('671b') || lower.includes('675b') || lower.includes('480b')) {
        caps.push({ type: 'size', icon: '🏋️', label: 'High Power' });
    } else if (lower.includes(':7b') || lower.includes(':8b') || lower.includes('24b') || lower.includes('3b') || lower.includes('4b')) {
        caps.push({ type: 'size', icon: '⚡', label: 'Fast' });
    }

    return caps;
}

function renderModelSelect() {
    const modelList = document.getElementById('model-list');
    if (!modelList) return;

    // Sort models
    let sortedModels = [...state.models];
    if (sortOrder === 'asc') {
        sortedModels.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortOrder === 'desc') {
        sortedModels.sort((a, b) => b.name.localeCompare(a.name));
    }

    // Legend HTML
    const legendHtml = `
        <div class="caps-legend">
            <div class="legend-item">🧠 Reasoning</div>
            <div class="legend-item">🌐 Search</div>
            <div class="legend-item">🛠️ Tools</div>
            <div class="legend-item">🏋️ Heavy</div>
            <div class="legend-item">⚡ Fast</div>
        </div>
    `;

    const modelsHtml = sortedModels.map(m => {
        const caps = getModelCapabilities(m.name);
        // Icons only inside the list
        const capsHtml = caps.map(c => `<span class="capability-icon" title="${c.label}">${c.icon}</span>`).join('');

        return `
        <div class="model-option ${m.name === state.currentModel ? 'selected' : ''}" 
             data-value="${m.name}"
             onclick="setModel('${m.name}')">
            <div class="model-info">
                <div style="display:flex; align-items:center; gap:8px; overflow:hidden; flex:1;">
                    <span class="model-name">${m.name}</span>
                    ${m.name === state.currentModel ? '<span style="color:var(--accent); font-weight:bold;">✓</span>' : ''}
                </div>
                <div class="model-capabilities">${capsHtml}</div>
            </div>
        </div>
    `}).join('');

    modelList.innerHTML = legendHtml + modelsHtml;

    if (!state.currentModel && state.models.length > 0) {
        setModel(state.models[0].name);
    } else if (state.currentModel) {
        const nameEl = document.getElementById('current-model-name');
        if (nameEl) nameEl.textContent = state.currentModel;
    }
}

// --- Viewport Fix for Mobile Keyboards ---
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        // Dynamically set app height to visual viewport height
        // This ensures footer sits right on top of keyboard
        dom.app.style.height = `${window.visualViewport.height}px`;

        // Scroll to bottom of chat when keyboard opens
        if (state.messages.length > 0) {
            setTimeout(() => {
                dom.messagesArea.scrollTop = dom.messagesArea.scrollHeight;
            }, 100);
        }
    });
}
// Run
init();
