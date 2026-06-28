const { useEffect, useState, useRef } = React;
const html = htm.bind(React.createElement);

const STORAGE_KEY = 'uitm-final-exams-v1';
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

function loadStoredExams() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
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
    
    // Bold **text**
    htmlStr = htmlStr.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // List bullet points * or -
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

const Sidebar = ({ exams, onNewChat, sidebarOpen, setSidebarOpen, darkMode, setDarkMode }) => {
    return html`
        <aside className=${`sidebar ${sidebarOpen ? 'open' : ''}`}>
            <div className="sidebar-header">
                <span className="sidebar-brand">
                    <img src="/assets/logo-icon.png" alt="F+" />
                    Finals+ AI
                </span>
                <button className="theme-btn menu-toggle" onClick=${() => setSidebarOpen(false)}>
                    <${Icon} name="X" size=${20} /><//>
                </button>
            </div>

            <button className="new-chat-btn" onClick=${onNewChat}>
                <${Icon} name="Plus" size=${16} ><//>
                New Chat
            </button>

            <div className="sidebar-content">
                <div className="sidebar-section-title">My Countdown Timers</div>
                <div className="sidebar-exam-list">
                    ${exams.length ? exams.map(exam => html`
                        <div className="sidebar-exam-card" key=${exam.code}>
                            <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span className="sidebar-exam-code">${exam.code}</span>
                                <span style=${{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)' }}>
                                    ${calculateDaysLeft(exam.dateStr)}
                                </span>
                            </div>
                            <div className="sidebar-exam-date">${formatDate(exam.dateStr)} - ${exam.location}</div>
                        </div>
                    `) : html`
                        <div style=${{ fontSize: '13px', color: 'var(--muted)', textAlign: 'center', padding: '12px' }}>
                            No exams loaded. Import timetable on home page to show timers here.
                        </div>
                    `}
                </div>
            </div>

            <div className="sidebar-footer">
                <a className="sidebar-link" href="/">
                    <${Icon} name="Home" size=${16} ><//>
                    Back to Home
                </a>
                <div className="sidebar-link" onClick=${() => setDarkMode(!darkMode)}>
                    <${Icon} name=${darkMode ? "Sun" : "Moon"} size=${16} ><//>
                    ${darkMode ? 'Light Mode' : 'Dark Mode'}
                </div>
            </div>
        </aside>
    `;
};

const ChatApp = () => {
    const [exams] = useState(loadStoredExams);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
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
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight - 10}px`;
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
            setMessages(prev => [...prev, { role: 'system-error', content: `Error: ${error.message}. Cuba lagi kejap lagi!` }]);
        } finally {
            setLoading(false);
        }
    };

    const triggerSuggestion = (val) => {
        handleSend(val);
    };

    const suggestions = [
        { title: "Tips Ulangkaji", desc: "Bagaimana cara ulangkaji yang berkesan untuk subjek susah?", query: "Bagi tips study last minute untuk subjek yang susah" },
        { title: "Jadual Belajar", desc: "Bantu saya buat perancangan study mengikut tarikh exam", query: "Macam mana nak rancang jadual study mengikut tarikh exam saya?" },
        { title: "Atasi Stres", desc: "Cadangan cara kurangkan nervous sebelum masuk dewan peperiksaan", query: "Cadangkan cara atasi stres exam" },
        { title: "Uji Kefahaman", desc: "Buat kuiz ringkas untuk menguji tahap hafalan topik", query: "Buatkan kuiz ringkas untuk bantu saya hafal subjek saya" }
    ];

    return html`
        <div className="chat-app">
            <${Sidebar} 
                exams=${exams} 
                onNewChat=${() => setMessages([])} 
                sidebarOpen=${sidebarOpen} 
                setSidebarOpen=${setSidebarOpen} 
                darkMode=${darkMode} 
                setDarkMode=${setDarkMode} 
            />

            <main className="chat-main">
                <div className="chat-topbar">
                    <div className="topbar-left">
                        <button className="menu-toggle" onClick=${() => setSidebarOpen(true)}>
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
                            <img className="welcome-logo" src="/assets/logo.png" alt="Finals+" />
                            <h1 className="welcome-title">Bagaimana saya boleh bantu anda study hari ini?</h1>
                            <p className="welcome-subtitle">Tanya tentang tips ulangkaji, pengurusan masa exam, atasi stres, atau minta AI tolong rancang jadual belajar anda.</p>
                            
                            <div className="suggestions-grid">
                                ${suggestions.map(s => html`
                                    <div className="suggestion-card" key=${s.title} onClick=${() => triggerSuggestion(s.query)}>
                                        <div className="suggestion-card-title">${s.title}</div>
                                        <div className="suggestion-card-desc">${s.desc}</div>
                                    </div>
                                `)}
                            </div>
                        </div>
                    ` : html`
                        <div className="chat-feed">
                            ${messages.map((msg, index) => html`
                                ${msg.role === 'system-error' ? html`
                                    <div key=${index} className="system-error-bubble">${msg.content}</div>
                                ` : html`
                                    <div key=${index} className=${`message-row ${msg.role}`}>
                                        <div className="avatar">
                                            ${msg.role === 'user' ? 'Me' : 'AI'}
                                        </div>
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
                            placeholder="Tanya tentang ulangkaji, jadual study, tips exam..." 
                            rows="1"
                            disabled=${loading}
                        />
                        <button className="send-btn" onClick=${() => handleSend()} disabled=${loading || !input.trim()}>
                            <${Icon} name="Send" size=${16} ><//>
                        </button>
                    </div>
                    <div className="chat-disclaimer">
                        Finals+ AI boleh membuat kesilapan. Sila semak jadual dan venue exam rasmi anda di Student Portal UiTM.
                    </div>
                </div>
            </main>
        </div>
    `;
};

ReactDOM.createRoot(document.getElementById('root')).render(html`<${ChatApp} ><//>`);
