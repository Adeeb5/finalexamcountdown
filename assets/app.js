import { animate, stagger } from 'https://cdn.jsdelivr.net/npm/motion@12.41.0/+esm';
window.Motion = { animate, stagger };

const { useEffect, useState } = React;
const html = htm.bind(React.createElement);

const STORAGE_KEY = 'uitm-final-exams-v1';
const SIMS_URL = '/api/exams';
const MATRIC_URL = '/api/matric';
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const COURSE_NAME_TRANSLATIONS = {
    'PENGENALAN KEPADA KOMUNIKASI DATA DAN PERANGKAIAN': 'Introduction to Data Communication and Networking',
    'INTRODUCTION TO DATA COMMUNICATIONS AND NETWORKING': 'Introduction to Data Communication and Networking',
    'PENGENALAN KEPADA KEBARANGKALIAN DAN STATISTIK': 'Introduction to Probability and Statistics',
    'ELEKTRONIK DIGITAL': 'Digital Electronics',
};

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function parseCodes(value) {
    return [...new Set(String(value || '').split(/[\s,;]+/).map(normalizeCode).filter(code => /^[A-Z]{2,4}\d{3}[A-Z]?$/.test(code)))];
}

function normalizeSubjectName(value) {
    const name = String(value || '').trim().replace(/\s+/g, ' ');
    if (!name) return '';
    return (COURSE_NAME_TRANSLATIONS[name.toUpperCase()] || name).toUpperCase();
}

function parseExamDate(dateText, timeText) {
    const dateMatch = String(dateText || '').trim().toUpperCase().match(/(\d{1,2})-([A-Z]{3})-(\d{2,4})/);
    if (!dateMatch) return null;
    const day = Number(dateMatch[1]);
    const month = MONTHS[dateMatch[2]];
    const rawYear = Number(dateMatch[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const startText = String(timeText || '').split('-')[0]?.trim() || '12:00 AM';
    const timeMatch = startText.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i);
    let hour = timeMatch ? Number(timeMatch[1]) : 0;
    const minute = timeMatch ? Number(timeMatch[2]) : 0;
    const meridiem = timeMatch ? timeMatch[3].toUpperCase() : 'AM';
    if (meridiem === 'PM' && hour !== 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    return new Date(year, month, day, hour, minute, 0).toISOString();
}

function calculateTimeLeft(dateStr) {
    const difference = +new Date(dateStr) - +new Date();
    if (difference <= 0) return null;
    return {
        days: Math.floor(difference / 86400000),
        hours: Math.floor((difference / 3600000) % 24),
        minutes: Math.floor((difference / 60000) % 60),
        seconds: Math.floor((difference / 1000) % 60),
    };
}

function getStatus(exam) {
    const now = new Date();
    const start = new Date(exam.dateStr);
    const end = exam.endTimeStr ? new Date(exam.endTimeStr) : new Date(start.getTime() + 3 * 3600000);
    if (now > end) return 'finished';
    if (now >= start && now <= end) return 'running';
    return 'upcoming';
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(dateStr) {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function statusCopy(exam) {
    const status = getStatus(exam);
    const timeLeft = calculateTimeLeft(exam.dateStr);
    if (status === 'finished') return 'Completed';
    if (status === 'running') return 'In progress';
    if (!timeLeft) return 'Scheduled';
    return `${timeLeft.days}d ${timeLeft.hours}h ${timeLeft.minutes}m`;
}

function parseSimsHtml(html, requestedCodes) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [...doc.querySelectorAll('table tbody tr')];
    const found = rows.map(row => {
        const cells = [...row.querySelectorAll('td')].map(cell => cell.textContent.trim().replace(/\s+/g, ' '));
        if (cells.length < 3) return null;
        const code = normalizeCode(cells[0]);
        const dateStr = parseExamDate(cells[1], cells[2]);
        if (!code || !dateStr) return null;
        return {
            code,
            dateStr,
            endTimeStr: null,
            rawDate: cells[1],
            rawTime: cells[2],
            location: 'Check official venue slip',
            source: 'SIMS exam schedule',
            updatedAt: new Date().toISOString(),
        };
    }).filter(Boolean);
    const foundCodes = new Set(found.map(exam => exam.code));
    return { found, missing: requestedCodes.filter(code => !foundCodes.has(code)) };
}

async function fetchExamSchedule(codes, skipAims = false) {
    const res = await fetch(SIMS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({ codes: codes.join(','), skip_aims: skipAims ? 'true' : 'false' }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || `SIMS returned ${res.status}`);
    return payload;
}

async function fetchMatricCourses(studentId) {
    const res = await fetch(MATRIC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({ studentId: studentId.trim() }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || `Timetable service returned ${res.status}`);
    return {
        codes: payload.codes || [],
        subjects: payload.subjects || [],
    };
}

function loadStored() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').map(exam => ({
            ...exam,
            subjectName: normalizeSubjectName(exam.subjectName),
        }));
    }
    catch { return []; }
}

function saveStored(exams) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(exams));
}

function getMotion() {
    const candidates = [window.Motion, window.motion, window.MotionOne, window.motionOne].filter(Boolean);
    return candidates.find(candidate => candidate.animate) || null;
}

function useClock() {
    const [, setTick] = useState(Date.now());
    useEffect(() => {
        const timer = setInterval(() => setTick(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
}

function toLucideName(name) {
    return String(name).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

const Icon = ({ name, size = 18, className = "icon" }) => html`
    <i data-lucide=${toLucideName(name)} className=${className} style=${{ width: size, height: size }} aria-hidden="true"></i>
`;

const PRIVACY_CONTENT = html`
    <${React.Fragment}>
        <p><strong>1. Privacy First</strong></p>
        <p>We value your privacy. This application does not collect, track, or share any of your personal identification information.</p>
        <p><strong>2. No Database / Server Storage</strong></p>
        <p>We do not store your student ID, matric number, or exam schedule in any database or external server. All processing is done directly on your browser.</p>
        <p><strong>3. Client-Side Cache (LocalStorage)</strong></p>
        <p>All your selected course codes and scheduled final exam data are cached locally inside your web browser using LocalStorage. You can clear this data at any time by clicking "Clear all saved subjects" in the Schedule section.</p>
        <p><strong>4. Timetable Fetching</strong></p>
        <p>When importing via matric number, your student ID is only sent temporarily to the timetable service to retrieve your registered course list, and is never logged or saved.</p>
    <//>
`;

const TERMS_CONTENT = html`
    <${React.Fragment}>
        <p><strong>1. Use of the Service</strong></p>
        <p>Finals+ is a personal tracking tool designed to help UiTM students monitor their upcoming exam countdowns. It is provided for personal use only.</p>
        <p><strong>2. No Affiliation</strong></p>
        <p>This web application is completely independent and has no official affiliation with Universiti Teknologi MARA (UiTM).</p>
        <p><strong>3. Accuracy of Schedule Data</strong></p>
        <p>While we pull exam dates directly from official sources, students must always verify their final schedules and venues with their official UiTM Student Portal or exam slip.</p>
        <p><strong>4. Disclaimer</strong></p>
        <p>The application is provided "as is" without warranty of any kind. The developer (Adeeb) is not responsible for any scheduling conflicts, missed exams, or errors in the countdown data.</p>
    <//>
`;

const Modal = ({ isOpen, onClose, title, content }) => {
    if (!isOpen) return null;
    return html`
        <div style=${{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(31, 36, 51, 0.4)',
            backdropFilter: 'blur(8px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 9999,
            padding: '20px'
        }} onClick=${onClose}>
            <div style=${{
                backgroundColor: '#ffffff',
                borderRadius: '16px',
                padding: '32px',
                maxWidth: '560px',
                width: '100%',
                maxHeight: '80vh',
                overflowY: 'auto',
                boxShadow: 'rgba(54, 38, 108, 0.16) 0 20px 60px',
                border: '1px solid var(--line)',
                position: 'relative'
            }} onClick=${e => e.stopPropagation()}>
                <button style=${{
                    position: 'absolute',
                    top: '20px',
                    right: '20px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--muted)',
                    padding: '4px'
                }} onClick=${onClose}>
                    <${Icon} name="X" size=${20} ><//>
                </button>
                <h3 style=${{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 700, marginBottom: '16px', color: 'var(--ink)' }}>${title}</h3>
                <div style=${{ color: 'var(--muted)', fontSize: '14px', lineHeight: 1.6, display: 'grid', gap: '12px' }}>
                    ${content}
                </div>
                <div style=${{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button className="pill primary" onClick=${onClose}>Close</button>
                </div>
            </div>
        </div>
    `;
};

const Logo = () => html`<img src="/assets/logo-icon-white.png" alt="F+" style=${{ height: '22px', verticalAlign: 'middle' }} />`;

const Nav = ({ darkMode, onToggleTheme }) => html`
    <${React.Fragment}>
        <nav className="global-nav" aria-label="Global">
            <div className="nav-inner">
                <span className="brand" style=${{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><${Logo} ><//> Finals+</span>
                <div className="nav-links" style=${{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                    <a href="#add"><${Icon} name="Plus" size=${14} ><//> Add</a>
                    <a href="#exams"><${Icon} name="BookOpen" size=${14} ><//> Exams</a>
                    <a href="#schedule"><${Icon} name="CalendarDays" size=${14} ><//> Schedule</a>
                    <a href="#chat"><${Icon} name="MessageSquare" size=${14} ><//> Tanya AI</a>
                    <button onClick=${onToggleTheme} style=${{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', padding: '4px' }} aria-label="Toggle dark mode" title="Toggle dark mode">
                        <${Icon} name=${darkMode ? "Sun" : "Moon"} size=${15} ><//>
                    </button>
                </div>
            </div>
        </nav>
        <div className="sub-nav">
            <div className="subnav-inner">
                <div className="sub-title"><img src="/assets/logo.png" alt="Finals+" style=${{ height: '28px', display: 'block' }} /></div>
                <div className="sub-actions">
                    <a className="text-link" href="#add"><${Icon} name="Download" size=${16} ><//> Import</a>
                    <a className="pill primary" href="#exams"><${Icon} name="ListChecks" size=${18} ><//> My exams</a>
                </div>
            </div>
        </div>
    <//>
`;

const Hero = ({ exams }) => {
    const upcoming = exams.filter(exam => getStatus(exam) === 'upcoming').sort((a, b) => new Date(a.dateStr) - new Date(b.dateStr));
    const nextExam = upcoming[0];
    const main = nextExam ? calculateTimeLeft(nextExam.dateStr)?.days ?? 0 : exams.length;
    const label = nextExam ? `days to ${nextExam.code}` : exams.length ? 'saved exam subjects' : 'saved subjects';
    const preview = (exams.length ? exams : [
        { code: 'CSC207', dateStr: new Date(Date.now() + 86400000 * 12).toISOString(), rawTime: 'Add your real course' },
        { code: 'MAT210', dateStr: new Date(Date.now() + 86400000 * 16).toISOString(), rawTime: 'Saved locally' },
        { code: 'ICT200', dateStr: new Date(Date.now() + 86400000 * 19).toISOString(), rawTime: 'Restored on reopen' },
    ]).slice(0, 3);
    return html`
        <section className="hero motion-root" id="overview">
            <div className="wrap hero-grid">
                <div>
                    <p className="eyebrow">Personal UiTM final exam tracker</p>
                    <h1>Your finals, saved for next time.</h1>
                    <p className="lead">Add course codes or import from matric number, then the app saves your selected exam subjects in this browser.</p>
                    <div className="hero-actions">
                        <a className="pill primary" href="#add"><${Icon} name="Plus" size=${18} ><//> Add subjects</a>
                        <a className="pill secondary" href="#schedule"><${Icon} name="CalendarDays" size=${18} ><//> View schedule</a>
                    </div>
                </div>
                <div className="device-stage" aria-hidden="true">
                    <div className="device">
                        <div className="screen">
                            <div className="screen-top">
                                <span style=${{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                    <img src="/assets/logo-icon.png" alt="F+" style=${{ height: '14px' }} /> Finals+
                                </span>
                                <span>${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                            </div>
                            <div className="big-count">${String(main).padStart(2, '0')}</div>
                            <p className="device-label">${label}</p>
                            <div className="mini-stack">
                                ${preview.map(exam => html`
                                    <div className="mini-row" key=${exam.code}>
                                        <div className="mini-dot">${exam.code.slice(0, 3)}</div>
                                        <div>
                                            <p className="mini-title">${exam.code}</p>
                                            <p className="mini-meta">${formatDate(exam.dateStr)}</p>
                                        </div>
                                        <p className="mini-state">${exam.rawTime || statusCopy(exam)}</p>
                                    </div>
                                `)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    `;
};

const AddPanel = ({ onAdd, onImport, busy }) => {
    const [codes, setCodes] = useState('');
    const [studentId, setStudentId] = useState('');
    return html`
        <section className="section light" id="add">
            <div className="wrap center">
                <h2>Build your own list.</h2>
                <p className="section-note">Search the official SIMS exam schedule by course code, or pull timetable subjects by matric number and match the courses that have finals.</p>
                <div className="tool-panel" id="import">
                    <div className="panel-card motion-item">
                        <h3>Add by course code</h3>
                        <p>Enter one or many codes separated by commas.</p>
                        <div className="input-row">
                            <input value=${codes} onChange=${e => setCodes(e.target.value.toUpperCase())} placeholder="CSC207, ICT200, MAT210" aria-label="Course codes" />
                            <button className="pill primary" disabled=${busy} onClick=${() => onAdd(codes)}><${Icon} name="Search" size=${18} ><//> Fetch</button>
                        </div>
                        <div className="help">Fetched subjects are cached locally in this browser and restored when the site opens again.</div>
                    </div>
                    <div className="panel-card motion-item">
                        <h3>Import by matric no.</h3>
                        <p>Uses the UiTM Timetable matric flow to get subjects, then checks those codes against SIMS final exam records.</p>
                        <div className="input-row">
                            <input value=${studentId} onChange=${e => setStudentId(e.target.value)} placeholder="Student ID / matric no." aria-label="Student ID or matric number" />
                            <button className="pill primary" disabled=${busy} onClick=${() => onImport(studentId)}><${Icon} name="Download" size=${18} ><//> Import</button>
                        </div>
                        <div className="help">The matric number is only sent when Import is pressed. This app does not save it.</div>
                    </div>
                </div>
            </div>
        </section>
    `;
};

const SkeletonCard = () => html`
    <div className="exam-card skeleton">
        <div>
            <div className="skeleton-line" style=${{ width: '40%', height: '34px', marginBottom: '12px' }}></div>
            <div className="skeleton-line" style=${{ width: '85%', height: '18px', marginBottom: '8px' }}></div>
            <div className="skeleton-line" style=${{ width: '60%', height: '18px', marginBottom: '16px' }}></div>
            <div className="skeleton-line" style=${{ width: '75%', height: '14px', marginBottom: '8px' }}></div>
            <div className="skeleton-line" style=${{ width: '50%', height: '14px', marginBottom: '8px' }}></div>
        </div>
        <div>
            <div className="skeleton-line" style=${{ width: '35%', height: '32px', borderRadius: '999px', marginTop: '22px' }}></div>
            <div className="card-actions" style=${{ marginTop: '16px' }}>
                <div className="skeleton-line" style=${{ width: '40%', height: '14px' }}></div>
                <div className="skeleton-line" style=${{ width: '38px', height: '38px', borderRadius: '50%' }}></div>
            </div>
        </div>
    </div>
`;

const ExamCard = ({ exam, onRemove }) => {
    const status = getStatus(exam);
    return html`
        <article className="exam-card motion-item">
            <div>
                <h3 className="exam-code">${exam.code}</h3>
                <p className="subject-name">${exam.subjectName || 'Subject name available after matric import'}</p>
                <p className="exam-meta">${formatDate(exam.dateStr)}<br />${exam.rawTime || formatTime(exam.dateStr)}<br />${exam.location}</p>
                <p className=${`lecturer-line ${exam.lecturer ? '' : 'missing-detail'}`}>
                    <${Icon} name="UserRound" size=${16} ><//> <span>${exam.lecturer || 'Lecturer name available after matric import'}</span>
                </p>
            </div>
            <div>
                <span className=${`status-pill ${status}`}><${Icon} name=${status === "finished" ? "CheckCircle2" : status === "running" ? "AlarmClock" : "Clock3"} size=${16} ><//> ${statusCopy(exam)}</span>
                <div className="card-actions">
                    <p className="exam-meta">${exam.source}</p>
                    <button className="icon-btn" onClick=${() => onRemove(exam.code)} aria-label=${`Remove ${exam.code}`} title=${`Remove ${exam.code}`}><${Icon} name="Trash2" size=${18} ><//></button>
                </div>
            </div>
        </article>
    `;
};

const Exams = ({ exams, onRemove, busy }) => html`
    <section className="section soft" id="exams">
        <div className="wrap center">
            <h2>${busy ? 'Fetching subjects...' : exams.length ? 'Your final exam subjects.' : 'No subjects saved yet.'}</h2>
            <p className="section-note">Only courses with final exam records are shown here. Remove anything you are not taking.</p>
            ${busy ? html`
                <div className="exam-grid">
                    <${SkeletonCard} ><//>
                    <${SkeletonCard} ><//>
                    <${SkeletonCard} ><//>
                </div>
            ` : exams.length ? html`
                <div className="exam-grid">
                    ${exams.map(exam => html`<${ExamCard} key=${exam.code} exam=${exam} onRemove=${onRemove} ><//>`)}
                </div>
            ` : html`
                <div className="empty">Add a course code or import by matric number to create your personal final exam list.</div>
            `}
        </div>
    </section>
`;

const Details = () => html`
    <section className="section dark">
        <div className="wrap center">
            <h2>Stay ahead of your finals.</h2>
            <p className="section-note">Track the remaining days, hours, and minutes for each exam. Plan your revision periods and walk into the exam hall with confidence.</p>
        </div>
    </section>
`;

const Schedule = ({ exams, onClear }) => {
    const sorted = [...exams].sort((a, b) => new Date(a.dateStr) - new Date(b.dateStr));
    return html`
        <section className="section light" id="schedule">
            <div className="wrap center">
                <h2>Saved schedule.</h2>
                <p className="section-note">This timetable is restored from local storage whenever you open this browser again.</p>
                ${sorted.length ? html`
                    <div className="schedule-list">
                        ${sorted.map(exam => html`
                            <div className="schedule-row" key=${exam.code}>
                                <div className="schedule-code">${exam.code}</div>
                                <div className="schedule-detail">${formatDate(exam.dateStr)} - ${exam.location}</div>
                                <div className="schedule-time">${exam.rawTime || formatTime(exam.dateStr)}</div>
                                <button className="icon-btn" onClick=${() => onClear(exam.code)} aria-label=${`Remove ${exam.code}`} title=${`Remove ${exam.code}`}><${Icon} name="Trash2" size=${18} ><//></button>
                            </div>
                        `)}
                    </div>
                ` : html`
                    <div className="empty">Your saved timetable will appear here.</div>
                `}
                ${sorted.length ? html`
                    <div style=${{ marginTop: 22 }}>
                        <button className="pill danger" onClick=${() => onClear()}><${Icon} name="Trash2" size=${18} ><//> Clear all saved subjects</button>
                    </div>
                ` : null}
            </div>
        </section>
    `;
};

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

const ChatPanel = ({ exams }) => {
    const [messages, setMessages] = useState([
        { role: 'model', content: 'Hi! Saya Finals+ AI. Tanyalah apa-apa tentang cuti UiTM, tarikh exam anda, atau tips study! 📚✨' }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const historyRef = React.useRef(null);

    useEffect(() => {
        if (historyRef.current) {
            historyRef.current.scrollTop = historyRef.current.scrollHeight;
        }
    }, [messages, loading]);

    const handleSend = async (text) => {
        const query = (text || input).trim();
        if (!query) return;
        if (!text) setInput('');

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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: query,
                    history: chatHistory,
                    exams: exams
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

    const suggestions = [
        "Bila cuti pertengahan semester?",
        "Bila cuti semester bermula?",
        "Berapa hari lagi exam mula?",
        "Bagi tips study last minute"
    ];

    return html`
        <section className="section soft" id="chat">
            <div className="wrap center">
                <h2>Tanya Finals+ AI.</h2>
                <p className="section-note">Dapatkan maklumat akademik, cuti UiTM, countdown exam, dan tips study daripada chatbot AI kami.</p>
                
                <div className="chat-container">
                    <div className="chat-history" ref=${historyRef}>
                        ${messages.map((msg, index) => html`
                            <div key=${index} className=${`chat-message ${msg.role}`} dangerouslySetInnerHTML=${{ __html: renderMarkdown(msg.content) }} />
                        `)}
                        ${loading ? html`
                            <div className="chat-message model">
                                <div className="typing-indicator">
                                    <div className="typing-dot"></div>
                                    <div className="typing-dot"></div>
                                    <div className="typing-dot"></div>
                                </div>
                            </div>
                        ` : null}
                    </div>
                    
                    <div className="chat-input-area">
                        <div className="chat-suggestions">
                            ${suggestions.map(s => html`
                                <button key=${s} className="suggestion-chip" onClick=${() => handleSend(s)} disabled=${loading}>${s}</button>
                            `)}
                        </div>
                        <div className="input-row">
                            <input 
                                value=${input} 
                                onChange=${e => setInput(e.target.value)} 
                                onKeyDown=${e => e.key === 'Enter' && !loading && handleSend()}
                                placeholder="Tanya tentang cuti, jadual exam, tips study..." 
                                disabled=${loading}
                            />
                            <button className="pill primary" onClick=${() => handleSend()} disabled=${loading || !input.trim()}>
                                <${Icon} name="Send" size=${18} ><//> Send
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    `;
};

const App = () => {
    useClock();
    const [exams, setExams] = useState(loadStored);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(null);
    const [modal, setModal] = useState({ isOpen: false, title: '', content: null });
    const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');

    useEffect(() => {
        if (darkMode) {
            document.body.classList.add('dark-mode');
            localStorage.setItem('theme', 'dark');
        } else {
            document.body.classList.remove('dark-mode');
            localStorage.setItem('theme', 'light');
        }
    }, [darkMode]);

    useEffect(() => saveStored(exams), [exams]);
    useEffect(() => {
        if (window.lucide) window.lucide.createIcons();
    });
    useEffect(() => {
        const runIntro = () => {
            const motion = getMotion();
            if (!motion) return false;
            const { animate, stagger } = motion;
            animate('.motion-root h1, .motion-root .lead, .motion-root .hero-actions, .device', { opacity: [0, 1], y: [18, 0] }, { duration: 0.7, delay: stagger(0.08), easing: 'ease-out' });
            animate('.panel-card', { opacity: [0, 1], y: [14, 0] }, { duration: 0.45, delay: stagger(0.04), easing: 'ease-out' });
            return true;
        };
        if (runIntro()) return;
        window.addEventListener('motion-ready', runIntro, { once: true });
        return () => window.removeEventListener('motion-ready', runIntro);
    }, []);
    useEffect(() => {
        const runCards = () => {
            const motion = getMotion();
            if (!motion) return false;
            const { animate } = motion;
            document.querySelectorAll('.exam-card, .panel-card').forEach(card => {
                if (!card.dataset.motionReady) {
                    card.dataset.motionReady = 'true';
                    card.addEventListener('pointerenter', () => animate(card, { y: -4, scale: 1.01 }, { duration: 0.18 }));
                    card.addEventListener('pointerleave', () => animate(card, { y: 0, scale: 1 }, { duration: 0.18 }));
                }
            });
            if (document.querySelector('.exam-card')) {
                animate('.exam-card', { opacity: [0, 1], y: [14, 0] }, { duration: 0.35, easing: 'ease-out' });
            }
            return true;
        };
        if (runCards()) return;
        window.addEventListener('motion-ready', runCards, { once: true });
        return () => window.removeEventListener('motion-ready', runCards);
    }, [exams.length]);

    const mergeExams = incoming => {
        setExams(prev => {
            const map = new Map(prev.map(exam => [exam.code, exam]));
            incoming.forEach(exam => map.set(exam.code, exam));
            return [...map.values()].sort((a, b) => new Date(a.dateStr) - new Date(b.dateStr));
        });
    };

    const addCodes = async value => {
        const codes = parseCodes(value);
        if (!codes.length) { setMessage({ type: 'error', text: 'Enter at least one valid course code, for example CSC207.' }); return; }
        setBusy(true);
        setMessage({ type: 'info', text: `Fetching ${codes.join(', ')} from SIMS exam schedule...` });
        try {
            const { found, missing } = await fetchExamSchedule(codes);
            if (found.length) {
                mergeExams(found);
                setTimeout(() => {
                    const el = document.getElementById('exams');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                }, 100);
            }
            const parts = [];
            if (found.length) parts.push(`Saved ${found.map(exam => exam.code).join(', ')}.`);
            if (missing.length) parts.push(`No final exam record found for ${missing.join(', ')}.`);
            setMessage({ type: found.length ? 'success' : 'error', text: parts.join(' ') });
        } catch (error) {
            setMessage({ type: 'error', text: `Could not fetch directly from SIMS. The official endpoint may block browser CORS, which means deployment needs a small backend proxy. Details: ${error.message}` });
        } finally {
            setBusy(false);
        }
    };

    const importMatric = async studentId => {
        if (!studentId.trim()) { setMessage({ type: 'error', text: 'Enter a matric number first.' }); return; }
        setBusy(true);
        setMessage({ type: 'info', text: 'Fetching timetable subjects, then checking finals in SIMS...' });
        try {
            const { codes, subjects } = await fetchMatricCourses(studentId);
            if (!codes.length) throw new Error('No course codes returned from timetable.');
            const detailsByCode = new Map(subjects.map(subject => [subject.code, subject]));
            const { found, missing } = await fetchExamSchedule(codes, true);
            const enriched = found.map(exam => ({
                ...exam,
                subjectName: normalizeSubjectName(exam.subjectName || detailsByCode.get(exam.code)?.subjectName),
                lecturer: detailsByCode.get(exam.code)?.lecturer || '',
            }));
            if (enriched.length) {
                mergeExams(enriched);
                setTimeout(() => {
                    const el = document.getElementById('exams');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                }, 100);
            }
            setMessage({ type: enriched.length ? 'success' : 'error', text: `Timetable returned ${codes.length} course code(s). Saved ${enriched.length} final exam subject(s) with lecturer details when available. ${missing.length ? `No final exam record for: ${missing.join(', ')}.` : ''}` });
        } catch (error) {
            setMessage({ type: 'error', text: `Matric import could not complete from this static page. It may need a backend proxy if an external API blocks browser requests. Details: ${error.message}` });
        } finally {
            setBusy(false);
        }
    };

    const removeExam = code => {
        if (!code) {
            setExams([]);
            setMessage({ type: 'success', text: 'Cleared all saved subjects from this browser.' });
            return;
        }
        setExams(prev => prev.filter(exam => exam.code !== code));
        setMessage({ type: 'success', text: `Removed ${code} from your saved list.` });
    };

    return html`
        <${React.Fragment}>
            <${Nav} darkMode=${darkMode} onToggleTheme=${() => setDarkMode(!darkMode)}><//>
            <${Hero} exams=${exams} ><//>
            <${AddPanel} onAdd=${addCodes} onImport=${importMatric} busy=${busy} ><//>
            ${message ? html`<div className=${`message ${message.type === 'error' ? 'error' : message.type === 'success' ? 'success' : ''}`}>${message.text}</div>` : null}
            <${Exams} exams=${exams} onRemove=${removeExam} busy=${busy} ><//>
            <${Details} ><//>
            <${ChatPanel} exams=${exams} ><//>
            <${Schedule} exams=${exams} onClear=${removeExam} ><//>
            <footer>
                <div className="wrap footer-grid">
                    <div className="footer-brand">
                        <img src="/assets/logo.png" alt="Finals+" className="footer-logo" />
                        <div className="footer-credits">Developed by Adeeb</div>
                        <div>&copy; ${new Date().getFullYear()} Finals+. All rights reserved.</div>
                    </div>
                    <div className="footer-links">
                        <a href="#privacy" onClick=${e => { e.preventDefault(); setModal({ isOpen: true, title: 'Privacy Policy', content: PRIVACY_CONTENT }); }}>Privacy Policy</a>
                        <a href="#terms" onClick=${e => { e.preventDefault(); setModal({ isOpen: true, title: 'Terms of Service', content: TERMS_CONTENT }); }}>Terms of Service</a>
                    </div>
                    <div className="footer-disclaimer">Sources: official SIMS exam schedule.</div>
                </div>
            </footer>
            <${Modal} isOpen=${modal.isOpen} onClose=${() => setModal({ ...modal, isOpen: false })} title=${modal.title} content=${modal.content}><//>
        <//>
    `;
};

ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} ><//>`);
