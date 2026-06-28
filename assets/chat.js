const { useEffect, useState, useRef } = React;
const html = htm.bind(React.createElement);

const STORAGE_KEY = 'uitm-final-exams-v1';
const CHAT_STORAGE_KEY = 'uitm-chat-session-v1';

function loadStoredExams() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
        return [];
    }
}

function loadChatSession() {
    try {
        return JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || '[]');
    } catch {
        return [];
    }
}

function calculateDaysLeft(dateStr) {
    const difference = +new Date(dateStr) - +new Date();
    if (difference <= 0) return 'Passed';
    const days = Math.floor(difference / 86400000);
    if (days === 0) return 'Today';
    return `${days}d left`;
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

function toLucideName(name) {
    return String(name).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

const Icon = ({ name, size = 18, className = "icon" }) => html`
    <i data-lucide=${toLucideName(name)} className=${className} style=${{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }} aria-hidden="true"></i>
`;

function renderMarkdown(text) {
    let htmlStr = String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    htmlStr = htmlStr.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    const lines = htmlStr.split('\n');
    let inList = false;
    const processedLines = lines.map(line => {
        const listMatch = line.match(/^[\s]*[-*][\s]+(.*)/);
        if (listMatch) {
            let item = listMatch[1];
            if (!inList) {
                inList = true;
                return '<ul><li>' + item + '</li>';
            }
            return '<li>' + item + '</li>';
        } else {
            if (inList) {
                inList = false;
                return '</ul>' + line;
            }
            return line;
        }
    });
    if (inList) {
        processedLines.push('</ul>');
    }
    
    return processedLines.join('<br />');
}

const Sidebar = ({ exams, onNewChat, sidebarOpen, setSidebarOpen, sidebarCollapsed, darkMode, setDarkMode, onToggleSidebar }) => {
    return html`
        <aside className=${`sidebar ${sidebarOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
            <div className="sidebar-header">
                <span className="sidebar-brand">
                    <img src="/assets/logo-icon.png" alt="F+" />
                    Finals+ AI
                </span>
                <button className="sidebar-toggle-btn" onClick=${onToggleSidebar} title=${sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
                    <${Icon} name=${sidebarCollapsed ? "PanelLeft" : "PanelLeftClose"} size=${18} ><//>
                </button>
            </div>

            <button className="new-chat-btn" onClick=${onNewChat} title="New Chat">
                <span className="sidebar-text">New Chat</span>
                <${Icon} name="SquarePen" size=${16} ><//>
            </button>

            <div className="sidebar-content">
                <div className="sidebar-section-title">My Countdown Timers</div>
                <div className="sidebar-exam-list">
                    ${exams.length ? exams.map(exam => html`
                        <div className="sidebar-exam-card" key=${exam.code}>
                            <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <strong className="sidebar-exam-code">${exam.code}</strong>
                                <span style=${{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)' }}>
                                    ${calculateDaysLeft(exam.dateStr)}
                                </span>
                            </div>
                            <div className="sidebar-exam-date">${formatDate(exam.dateStr)} - ${exam.location}</div>
                        </div>
                    `) : html`
                        <div style=${{ fontSize: '12px', color: 'var(--muted)', textAlign: 'center', padding: '12px', border: '1px dashed var(--line)', borderRadius: '6px' }}>
                            No exams loaded. Import timetable on home page to show timers here.
                        </div>
                    `}
                </div>
            </div>

            <div className="sidebar-footer">
                <div className="sidebar-link" onClick=${() => setDarkMode(!darkMode)} title=${darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
                    <${Icon} name=${darkMode ? "Sun" : "Moon"} size=${16} ><//>
                    <span className="sidebar-text">${darkMode ? 'Light Mode' : 'Dark Mode'}</span>
                </div>
                <a className="sidebar-link" href="/" title="Back to Home">
                    <${Icon} name="Home" size=${16} ><//>
                    <span className="sidebar-text">Back to Home</span>
                </a>
            </div>
        </aside>
    `;
};

const ChatApp = () => {
    const [exams] = useState(loadStoredExams);
    const [messages, setMessages] = useState(loadChatSession);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');

    const feedEndRef = useRef(null);
    const textareaRef = useRef(null);

    useEffect(() => {
        if (darkMode) {
            document.body.classList.add('dark-mode');
            localStorage.setItem('theme', 'dark');
        } else {
            document.body.classList.remove('dark-mode');
            localStorage.setItem('theme', 'light');
        }
    }, [darkMode]);

    useEffect(() => {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
        if (feedEndRef.current) {
            feedEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, loading]);

    useEffect(() => {
        if (window.lucide) window.lucide.createIcons();
    });

    const handleTextareaChange = (e) => {
        setInput(e.target.value);
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    };

    const handleSend = async (text) => {
        const query = (text || input).trim();
        if (!query) return;
        if (!text) {
            setInput('');
            if (textareaRef.current) textareaRef.current.style.height = '24px';
        }

        const newMessages = [...messages, { role: 'user', content: query }];
        setMessages(newMessages);
        setLoading(true);

        try {
            const chatHistory = newMessages.slice(0, -1).map(msg => ({
                role: msg.role,
                content: msg.content
            })).slice(-6);

            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                body: new URLSearchParams({
                    message: query,
                    history: JSON.stringify(chatHistory),
                    exams: JSON.stringify(exams)
                })
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || `Server error: ${res.status}`);
            }

            setMessages(prev => [...prev, { role: 'model', content: data.reply }]);
        } catch (error) {
            setMessages(prev => [...prev, { role: 'system-error', content: `Error: ${error.message}. Please try again shortly.` }]);
        } finally {
            setLoading(false);
        }
    };

    const triggerSuggestion = (val) => {
        handleSend(val);
    };

    const suggestions = [
        { title: "Study tips", icon: "BookOpen", query: "Give me last-minute study tips for difficult subjects" },
        { title: "Plan schedule", icon: "Calendar", query: "How do I plan a study schedule based on my exam dates?" },
        { title: "Manage stress", icon: "Smile", query: "Suggest ways to manage exam stress" },
        { title: "Create quiz", icon: "HelpCircle", query: "Create a simple quiz to help me memorize my subjects" }
    ];

    const renderInputBox = () => html`
        <div className="chat-input-wrapper">
            <textarea 
                ref=${textareaRef}
                value=${input}
                onChange=${handleTextareaChange}
                onKeyDown=${e => {
                    if (e.key === 'Enter' && !e.shiftKey && !loading) {
                        e.preventDefault();
                        handleSend();
                    }
                }}
                placeholder="Ask anything..." 
                rows="1"
                disabled=${loading}
            />
            <button className="send-btn" onClick=${() => handleSend()} disabled=${loading || !input.trim()}>
                <${Icon} name="ArrowUp" size=${16} ><//>
            </button>
        </div>
    `;

    const toggleSidebar = () => {
        if (window.innerWidth <= 768) {
            setSidebarOpen(!sidebarOpen);
        } else {
            setSidebarCollapsed(!sidebarCollapsed);
        }
    };

    return html`
        <div className=${`chat-app ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
            <${Sidebar} 
                exams=${exams} 
                onNewChat=${() => setMessages([])} 
                sidebarOpen=${sidebarOpen} 
                setSidebarOpen=${setSidebarOpen} 
                sidebarCollapsed=${sidebarCollapsed}
                darkMode=${darkMode} 
                setDarkMode=${setDarkMode} 
                onToggleSidebar=${toggleSidebar}
            ><//>

            <main className=${`chat-main ${messages.length > 0 ? 'active' : ''}`}>
                <div className="chat-topbar">
                    <div className="topbar-left">
                        <button className="menu-toggle" onClick=${() => setSidebarOpen(!sidebarOpen)} title="Toggle sidebar">
                            <${Icon} name="Menu" size=${20} ><//>
                        </button>
                    </div>
                    <button className="theme-btn" onClick=${() => setDarkMode(!darkMode)}>
                        <${Icon} name=${darkMode ? "Sun" : "Moon"} size=${20} ><//>
                    </button>
                </div>

                <div className="chat-feed-wrapper">
                    ${messages.length === 0 ? html`
                        <div className="welcome-container">
                            <h1 className="welcome-title">What can I help with?</h1>
                        </div>
                    ` : html`
                        <div className="chat-feed">
                            ${messages.map((msg, index) => html`
                                ${msg.role === 'system-error' ? html`
                                    <div key=${index} className="system-error-bubble">${msg.content}</div>
                                ` : html`
                                    <div key=${index} className=${`message-row ${msg.role}`}>
                                        ${msg.role === 'model' ? html`
                                            <div className="avatar">AI</div>
                                        ` : null}
                                        <div className="bubble" dangerouslySetInnerHTML=${{ __html: renderMarkdown(msg.content) }} />
                                    </div>
                                `}
                            `)}
                            ${loading ? html`
                                <div className="message-row model">
                                    <div className="avatar">AI</div>
                                    <div className="bubble">
                                        <div className="typing-indicator">
                                            <div className="typing-dot"></div>
                                            <div className="typing-dot"></div>
                                            <div className="typing-dot"></div>
                                        </div>
                                    </div>
                                </div>
                            ` : null}
                            <div ref=${feedEndRef} />
                        </div>
                    `}
                </div>

                <div className="chat-input-container">
                    ${renderInputBox()}
                    
                    ${messages.length === 0 ? html`
                        <div className="suggestions-row">
                            ${suggestions.map(s => html`
                                <button className="suggestion-pill" key=${s.title} onClick=${() => triggerSuggestion(s.query)}>
                                    <${Icon} name=${s.icon} size=${14} ><//>
                                    ${s.title}
                                </button>
                            `)}
                        </div>
                    ` : html`
                        <div className="chat-disclaimer">
                            Finals+ AI can make mistakes. Please check your official exam schedules and venues.
                        </div>
                    `}
                </div>
            </main>
        </div>
    `;
};

ReactDOM.createRoot(document.getElementById('root')).render(html`<${ChatApp} ><//>`);
