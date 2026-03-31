/* ─────────────────────────────────────────
   AI Mock Interviewer Pro — interviewer.js
   v2.0 | Integration-ready
───────────────────────────────────────── */

// ── Config (change SERVER_URL to embed in another project) ──
const SERVER_URL = 'http://127.0.0.1:8000';

// ── State ──
let state = {
  sessionId: null,
  domain: '',
  provider: 'groq',
  inInterview: false,
  lastQuestion: '',
  questionCount: 0,
  startTime: null,
  timerInterval: null,
  speechEnabled: false,
  micActive: false,
  recognition: null,
  synth: window.speechSynthesis || null,
  voices: [],
  selectedVoice: null,
  sending: false,
  resumeFile: null,
};

// ── DOM refs ──
const $ = id => document.getElementById(id);
const screens = {
  welcome:   $('screen-welcome'),
  interview: $('screen-interview'),
  dashboard: $('screen-dashboard'),
  history:   $('screen-history'),
};

// ─────────────────────────────────────────
// API wrapper — single place to change base URL
// ─────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const url = `${SERVER_URL}${path}`;
  try {
    const res = await fetch(url, { ...options });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
      throw new Error(`Cannot reach server at ${SERVER_URL}. Is the backend running?`);
    }
    throw e;
  }
}

// ─────────────────────────────────────────
// Screen navigation
// ─────────────────────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle('active', k === name);
  });
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.screen === name);
  });
}

// ─────────────────────────────────────────
// Toast
// ─────────────────────────────────────────
let toastTimer = null;
function toast(msg, type = 'info') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ─────────────────────────────────────────
// Loading overlay
// ─────────────────────────────────────────
function setLoading(active, msg = 'Processing…') {
  const ov = $('loading-overlay');
  ov.classList.toggle('active', active);
  const txt = ov.querySelector('.loading-text');
  if (txt) txt.textContent = msg;
}

// ─────────────────────────────────────────
// Chat — add message bubble
// ─────────────────────────────────────────
const AVATARS = {
  interviewer: '<i class="fas fa-robot"></i>',
  user:        '<i class="fas fa-user"></i>',
  clarify:     '<i class="fas fa-question-circle"></i>',
  feedback:    '<i class="fas fa-comment-dots"></i>',
  system:      '',
};

function addMsg(role, text, timestamp = true) {
  const container = $('chat-messages');
  if (!container) return;

  const wrapper = document.createElement('div');
  wrapper.className = `msg ${role}`;

  if (role !== 'system') {
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.innerHTML = AVATARS[role] || '<i class="fas fa-info"></i>';
    wrapper.appendChild(avatar);
  }

  const content = document.createElement('div');
  content.style.flex = '1';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = text;
  content.appendChild(bubble);

  if (timestamp && role !== 'system') {
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    content.appendChild(meta);
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
}

// ─────────────────────────────────────────
// Typing indicator
// ─────────────────────────────────────────
function setTyping(active) {
  const el = $('typing-indicator');
  if (el) el.classList.toggle('active', active);
  const container = $('chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
}

// ─────────────────────────────────────────
// Sidebar stats
// ─────────────────────────────────────────
function updateSidebar() {
  const qEl = $('stat-questions');
  const dEl = $('stat-domain');
  const pEl = $('stat-provider');
  const stEl = $('stat-stage');
  if (qEl) qEl.textContent = state.questionCount;
  if (dEl) dEl.textContent = state.domain || '—';
  if (pEl) pEl.textContent = state.provider.charAt(0).toUpperCase() + state.provider.slice(1);
  if (stEl) stEl.textContent = state.questionCount < 5 ? 'Basic' : 'Technical';
  const provBadge = $('header-provider-badge');
  if (provBadge) provBadge.textContent = state.provider.toUpperCase();
}

function startTimer() {
  state.startTime = Date.now();
  state.timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - state.startTime) / 1000);
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    const el = $('elapsed-timer');
    if (el) el.textContent = `${m}:${sec}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
}

// ─────────────────────────────────────────
// Speech
// ─────────────────────────────────────────
function initSpeech() {
  if (!('speechSynthesis' in window)) return;
  const loadVoices = () => {
    state.voices = window.speechSynthesis.getVoices();
    const sel = $('voice-select');
    if (sel) {
      sel.innerHTML = '';
      state.voices.forEach((v, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `${v.name} (${v.lang})`;
        sel.appendChild(opt);
      });
    }
    state.selectedVoice = state.voices.find(v => v.lang.startsWith('en')) || state.voices[0];
  };
  window.speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
}

function speak(text) {
  if (!state.speechEnabled || !state.synth || !text) return;
  state.synth.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  if (state.selectedVoice) utt.voice = state.selectedVoice;
  utt.rate = 0.95;
  utt.pitch = 1;
  state.synth.speak(utt);
}

function initMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $('mic-btn')?.setAttribute('title', 'Speech recognition not supported'); return; }
  const rec = new SR();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = 'en-US';
  rec.onresult = e => {
    const text = e.results[0][0].transcript;
    const inp = $('user-input');
    if (inp) { inp.value = text; autoResize(inp); }
  };
  rec.onend = () => {
    state.micActive = false;
    $('mic-btn')?.classList.remove('recording');
  };
  rec.onerror = () => {
    state.micActive = false;
    $('mic-btn')?.classList.remove('recording');
  };
  state.recognition = rec;
}

// ─────────────────────────────────────────
// Provider selection
// ─────────────────────────────────────────
function initProviderCards() {
  document.querySelectorAll('.provider-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.provider-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.provider = card.dataset.provider;
      updateSidebar();
    });
  });
}

// ─────────────────────────────────────────
// Domain dropdown + Start button
// ─────────────────────────────────────────
function initDomainBtns() {
  const sel = $('domain-select');
  const customGroup = $('custom-domain-group');

  // Show/hide custom field when 'custom' is selected
  sel?.addEventListener('change', () => {
    if (sel.value === 'custom') {
      if (customGroup) customGroup.style.display = 'flex';
      $('custom-domain-field')?.focus();
    } else {
      if (customGroup) customGroup.style.display = 'none';
    }
  });

  // Start button handler
  $('start-btn')?.addEventListener('click', () => {
    let domain = sel?.value || 'Software Engineering';
    if (domain === 'custom') {
      domain = $('custom-domain-field')?.value.trim();
      if (!domain) { toast('Please enter a custom domain', 'error'); return; }
    }
    startInterview(domain);
  });
}

// ─────────────────────────────────────────
// Resume upload
// ─────────────────────────────────────────
function initResume() {
  const drop = $('resume-drop');
  const inp = $('resume-file-input');
  const fileName = $('resume-file-name');
  const startBtn = $('resume-start-btn');
  const domainInp = $('resume-domain-input');

  if (!drop) return;

  drop.addEventListener('click', () => inp?.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('drag');
    handleFile(e.dataTransfer.files[0]);
  });
  inp?.addEventListener('change', e => handleFile(e.target.files[0]));

  function handleFile(file) {
    if (!file) return;
    state.resumeFile = file;
    if (fileName) { fileName.textContent = `📄 ${file.name}`; fileName.style.display = 'block'; }
    if ($('resume-domain-row')) $('resume-domain-row').style.display = 'flex';
  }

  startBtn?.addEventListener('click', () => {
    if (!state.resumeFile) { toast('Please upload a resume first', 'error'); return; }
    const domain = domainInp?.value.trim() || 'General';
    startInterviewWithResume(domain, state.resumeFile);
  });
}

// ─────────────────────────────────────────
// Start interview (no resume)
// ─────────────────────────────────────────
async function startInterview(domain) {
  state.domain = domain;
  state.inInterview = true;
  state.questionCount = 0;
  state.sessionId = null;
  state.lastQuestion = '';

  showScreen('interview');
  $('chat-messages').innerHTML = '';
  addMsg('system', `Starting ${state.provider.toUpperCase()} interview in ${domain}…`, false);
  setTyping(true);
  startTimer();
  updateSidebar();

  const fd = new FormData();
  fd.append('domain', domain);
  fd.append('model_provider', state.provider);

  try {
    const data = await apiFetch('/api/interview/start', { method: 'POST', body: fd });
    state.sessionId = data.session_id;
    state.lastQuestion = data.reply;
    state.questionCount = 1;
    setTyping(false);
    addMsg('interviewer', data.reply);
    speak(data.reply);
    updateSidebar();
  } catch (e) {
    setTyping(false);
    addMsg('system', `❌ ${e.message}`);
    toast(e.message, 'error');
  }
}

// ─────────────────────────────────────────
// Start interview (with resume)
// ─────────────────────────────────────────
async function startInterviewWithResume(domain, file) {
  state.domain = domain;
  state.inInterview = true;
  state.questionCount = 0;
  state.sessionId = null;

  showScreen('interview');
  $('chat-messages').innerHTML = '';
  addMsg('system', `Analysing resume for ${domain} role…`, false);
  setTyping(true);
  startTimer();
  updateSidebar();

  const fd = new FormData();
  fd.append('domain', domain);
  fd.append('model_provider', state.provider);
  fd.append('resume', file);

  try {
    const data = await apiFetch('/api/interview/start', { method: 'POST', body: fd });
    state.sessionId = data.session_id;
    state.lastQuestion = data.reply;
    state.questionCount = 1;
    setTyping(false);
    addMsg('interviewer', data.reply);
    speak(data.reply);
    updateSidebar();
  } catch (e) {
    setTyping(false);
    addMsg('system', `❌ ${e.message}`);
    toast(e.message, 'error');
  }
}

// ─────────────────────────────────────────
// Send user answer
// ─────────────────────────────────────────
async function sendAnswer() {
  if (state.sending || !state.sessionId) return;
  const inp = $('user-input');
  const text = inp?.value.trim();
  if (!text) return;

  state.sending = true;
  inp.value = '';
  autoResize(inp);
  addMsg('user', text);
  setTyping(true);

  try {
    const data = await apiFetch('/api/interview/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: state.sessionId, answer: text }),
    });
    state.lastQuestion = data.reply;
    state.questionCount++;
    setTyping(false);
    addMsg('interviewer', data.reply);
    speak(data.reply);
    updateSidebar();
  } catch (e) {
    setTyping(false);
    addMsg('system', `❌ ${e.message}`);
    toast(e.message, 'error');
  } finally {
    state.sending = false;
  }
}

// ─────────────────────────────────────────
// Clarify — FIX: does NOT echo user message
// ─────────────────────────────────────────
async function requestClarify() {
  if (!state.sessionId) return;
  setTyping(true);
  try {
    const data = await apiFetch('/api/interview/clarify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: state.sessionId, answer: '' }),
    });
    setTyping(false);
    addMsg('clarify', data.reply);   // shown as clarify bubble — no user echo
    speak(data.reply);
  } catch (e) {
    setTyping(false);
    toast(e.message, 'error');
  }
}

// ─────────────────────────────────────────
// Repeat last question
// ─────────────────────────────────────────
function repeatQuestion() {
  if (state.lastQuestion) {
    addMsg('interviewer', state.lastQuestion);
    speak(state.lastQuestion);
  } else {
    toast('No question to repeat', 'error');
  }
}

// ─────────────────────────────────────────
// Request feedback
// ─────────────────────────────────────────
async function requestFeedback() {
  if (!state.sessionId) return;
  setTyping(true);
  try {
    const data = await apiFetch('/api/interview/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: state.sessionId, answer: '' }),
    });
    setTyping(false);
    addMsg('feedback', data.reply);
    speak(data.reply);
  } catch (e) {
    setTyping(false);
    toast(e.message, 'error');
  }
}

// ─────────────────────────────────────────
// End interview → Dashboard
// ─────────────────────────────────────────
async function endInterview() {
  if (!state.sessionId || !state.inInterview) return;
  state.inInterview = false;
  stopTimer();
  setLoading(true, 'Generating your performance report…');

  try {
    const data = await apiFetch('/api/interview/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: state.sessionId, answer: '' }),
    });
    setLoading(false);
    renderDashboard(data.score, data.reply, state.domain, state.sessionId);
    showScreen('dashboard');
  } catch (e) {
    setLoading(false);
    toast(e.message, 'error');
    state.inInterview = true;
  }
}

// ─────────────────────────────────────────
// Chart.js instances (destroy before re-render)
// ─────────────────────────────────────────
let radarChart = null;
let barChart = null;

function destroyCharts() {
  if (radarChart) { radarChart.destroy(); radarChart = null; }
  if (barChart) { barChart.destroy(); barChart = null; }
}

// ─────────────────────────────────────────
// Parse summary markdown → clean HTML sections
// ─────────────────────────────────────────
function parseSummary(text) {
  if (!text) return '<p style="color:var(--text-muted)">No summary available.</p>';
  // Strip any existing HTML tags that markdown2 may have added
  const clean = text.replace(/<[^>]+>/g, '').trim();

  const sections = [];
  const sectionRegex = /\*\*(.+?)\*\*\s*([\s\S]*?)(?=\*\*|$)/g;
  let match;
  while ((match = sectionRegex.exec(clean)) !== null) {
    const heading = match[1].trim();
    const body = match[2].trim()
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    sections.push({ heading, body });
  }

  if (sections.length === 0) {
    // Fallback: render raw as paragraph
    return `<p>${clean}</p>`;
  }

  return sections.map(({ heading, body }) => {
    const isBullet = heading.toLowerCase().includes('strength') || heading.toLowerCase().includes('improvement');
    const content = isBullet
      ? '<ul>' + body.map(l => `<li>${l.replace(/^[-•]\s*/, '')}</li>`).join('') + '</ul>'
      : `<p>${body.join(' ')}</p>`;
    return `<div class="summary-section">
      <div class="summary-section-title">${heading}</div>
      <div class="summary-section-body">${content}</div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────
// Render Dashboard — Chart.js based
// ─────────────────────────────────────────
function renderDashboard(score, summaryRaw, domain, sessionId) {
  if (!score) score = { overall: 0, communication: 0, technical: 0, confidence: 0, strengths: [], improvements: [] };

  const s = {
    overall:       score.overall       || 0,
    communication: score.communication || 0,
    technical:     score.technical     || 0,
    confidence:    score.confidence    || 0,
  };

  // Meta
  const meta = $('dash-meta');
  if (meta) meta.textContent = `${domain} · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  // Overall score badge
  const badge = $('dash-overall-badge');
  if (badge) {
    badge.textContent = s.overall;
    badge.className = 'overall-badge ' + (s.overall >= 80 ? 'high' : s.overall >= 60 ? 'mid' : 'low');
  }

  // Destroy old charts before re-creating
  destroyCharts();

  // ── Radar Chart ──
  const radarCtx = $('radar-chart');
  if (radarCtx) {
    radarChart = new Chart(radarCtx, {
      type: 'radar',
      data: {
        labels: ['Communication', 'Technical', 'Confidence'],
        datasets: [{
          label: 'Score',
          data: [s.communication, s.technical, s.confidence],
          backgroundColor: 'rgba(79,70,229,0.15)',
          borderColor: '#6366f1',
          borderWidth: 2,
          pointBackgroundColor: '#6366f1',
          pointRadius: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            min: 0, max: 100, ticks: { stepSize: 25, font: { size: 10 }, color: '#94a3b8' },
            grid: { color: '#e2e8f0' },
            pointLabels: { font: { size: 12, weight: '600' }, color: '#475569' },
            angleLines: { color: '#e2e8f0' },
          }
        },
        plugins: { legend: { display: false } },
        animation: { duration: 900, easing: 'easeOutQuart' },
      }
    });
  }

  // ── Bar Chart ──
  const barCtx = $('bar-chart');
  if (barCtx) {
    barChart = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: ['Communication', 'Technical', 'Confidence', 'Overall'],
        datasets: [{
          data: [s.communication, s.technical, s.confidence, s.overall],
          backgroundColor: ['#6366f1', '#f59e0b', '#3b82f6', '#10b981'],
          borderRadius: 6,
          borderSkipped: false,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { min: 0, max: 100, grid: { color: '#f1f5f9' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
          y: { grid: { display: false }, ticks: { color: '#475569', font: { size: 12, weight: '600' } } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: ctx => ` Score: ${ctx.raw}/100` }
          }
        },
        animation: { duration: 900, easing: 'easeOutQuart' },
      }
    });
  }

  // Strengths
  const sEl = $('dash-strengths');
  if (sEl) {
    sEl.innerHTML = (score.strengths || []).length
      ? (score.strengths).map(s => `<li>${s}</li>`).join('')
      : '<li style="color:var(--text-muted)">No data</li>';
  }

  // Improvements
  const iEl = $('dash-improvements');
  if (iEl) {
    iEl.innerHTML = (score.improvements || []).length
      ? (score.improvements).map(s => `<li>${s}</li>`).join('')
      : '<li style="color:var(--text-muted)">No data</li>';
  }

  // Summary — parse to structured sections
  const sumEl = $('dash-summary');
  if (sumEl) sumEl.innerHTML = parseSummary(summaryRaw);
}


// ─────────────────────────────────────────
// History screen
// ─────────────────────────────────────────
async function loadHistory() {
  const tbody = $('history-body');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" class="history-empty"><i class="fas fa-spinner fa-spin"></i>Loading history…</td></tr>`;

  try {
    const data = await apiFetch('/api/interview/history');
    const sessions = data.history || [];

    if (sessions.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="5">
          <div class="history-empty">
            <i class="fas fa-history"></i>
            No interviews completed yet. Start your first mock interview!
          </div>
        </td></tr>`;
      return;
    }

    tbody.innerHTML = sessions.map(s => {
      const score = s.score?.overall ?? '—';
      const chipClass = score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low';
      const date = s.ended_at ? new Date(s.ended_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
      const qs = s.questions_count || 0;
      return `
        <tr>
          <td><span class="domain-tag">${s.domain}</span></td>
          <td>${date}</td>
          <td>${qs} Q&amp;As</td>
          <td><span class="score-chip ${chipClass}">${score}</span></td>
          <td>
            <button class="hint-btn" onclick="viewSessionDetail('${s.session_id}')">
              <i class="fas fa-chart-bar"></i> Details
            </button>
          </td>
        </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="history-empty">⚠ ${e.message}</td></tr>`;
  }
}

async function viewSessionDetail(sessionId) {
  setLoading(true, 'Loading session details…');
  try {
    const data = await apiFetch(`/api/interview/session/${sessionId}`);
    setLoading(false);
    renderDashboard(data.score, data.summary, data.domain, sessionId);
    showScreen('dashboard');
  } catch (e) {
    setLoading(false);
    toast(e.message, 'error');
  }
}

// ─────────────────────────────────────────
// Textarea auto-resize
// ─────────────────────────────────────────
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

// ─────────────────────────────────────────
// Settings panel
// ─────────────────────────────────────────
function initSettings() {
  const btn = $('settings-btn');
  const panel = $('settings-panel');
  if (!btn || !panel) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    panel.classList.toggle('open');
  });
  document.addEventListener('click', () => panel.classList.remove('open'));
  panel.addEventListener('click', e => e.stopPropagation());

  // Speech toggle
  $('speech-toggle')?.addEventListener('change', e => {
    state.speechEnabled = e.target.checked;
    if (!state.speechEnabled && state.synth) state.synth.cancel();
  });

  // Voice select
  $('voice-select')?.addEventListener('change', e => {
    state.selectedVoice = state.voices[parseInt(e.target.value)];
  });
}

// ─────────────────────────────────────────
// Nav buttons
// ─────────────────────────────────────────
function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.screen;
      if (target === 'history') loadHistory();
      showScreen(target);
    });
  });
}

// ─────────────────────────────────────────
// Input area
// ─────────────────────────────────────────
function initInput() {
  const inp = $('user-input');
  const sendBtn = $('send-btn');
  const micBtn = $('mic-btn');

  inp?.addEventListener('input', () => autoResize(inp));
  inp?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAnswer();
    }
  });

  sendBtn?.addEventListener('click', sendAnswer);

  micBtn?.addEventListener('click', () => {
    if (!state.recognition) { toast('Speech recognition not supported', 'error'); return; }
    if (state.micActive) {
      state.recognition.stop();
      state.micActive = false;
      micBtn.classList.remove('recording');
    } else {
      state.recognition.start();
      state.micActive = true;
      micBtn.classList.add('recording');
    }
  });

  // Hint buttons
  $('hint-clarify')?.addEventListener('click', requestClarify);
  $('hint-repeat')?.addEventListener('click', repeatQuestion);
  $('hint-feedback')?.addEventListener('click', requestFeedback);

  // Sidebar buttons
  $('sidebar-clarify')?.addEventListener('click', requestClarify);
  $('sidebar-repeat')?.addEventListener('click', repeatQuestion);
  $('sidebar-end')?.addEventListener('click', () => {
    if (confirm('End the interview and view your results?')) endInterview();
  });

  // Dashboard actions
  $('dash-new-btn')?.addEventListener('click', () => {
    state.resumeFile = null;
    showScreen('welcome');
  });
  $('dash-history-btn')?.addEventListener('click', () => {
    loadHistory();
    showScreen('history');
  });

  // History back
  $('history-back-btn')?.addEventListener('click', () => showScreen('welcome'));
}

// ─────────────────────────────────────────
// Boot
// ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initProviderCards();
  initDomainBtns();
  initResume();
  initInput();
  initNav();
  initSettings();
  initSpeech();
  initMic();
  showScreen('welcome');
  updateSidebar();
});
