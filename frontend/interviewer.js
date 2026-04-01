/* ─────────────────────────────────────────
   Guided Sanctuary | interviewer.js
   v2.2 | Production-Ready UI & Voice
───────────────────────────────────────── */

const SERVER_URL = '';

let state = {
  sessionId: null,
  domain: 'Software Engineer',
  provider: 'groq',
  inInterview: false,
  questionCount: 0,
  sttActive: false,
};

const $ = id => document.getElementById(id);

// ── TTS (Recruiter Voice) ──
function speak(text) {
  if (!text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  window.speechSynthesis.speak(utterance);
}

// ── API Helper ──
async function apiFetch(endpoint, options = {}) {
  const url = `${SERVER_URL}${endpoint}`;
  const response = await fetch(url, options);
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Service Error' }));
    throw new Error(err.detail || response.statusText);
  }
  return response.json();
}

// ── UI Logic ──
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = $(`screen-${screenId}`);
  if (target) target.classList.add('active');
  
  if (screenId === 'history') loadHistory();
}

function setLoading(show, text = 'Processing...') {
  const overlay = $('loading-overlay');
  if (overlay) {
    overlay.querySelector('.loading-text').textContent = text;
    overlay.style.display = show ? 'flex' : 'none';
  }
}

// ── Meeting Controls ──
let recognition;
function initSTT() {
  if ('webkitSpeechRecognition' in window) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    
    recognition.onresult = (e) => {
      const text = e.results[0][0].transcript;
      sendAnswer(text);
    };
    
    recognition.onstart = () => {
      state.sttActive = true;
      $('mic-btn').classList.add('active');
    };
    recognition.onend = () => {
      state.sttActive = false;
      $('mic-btn').classList.remove('active');
    };
  }
}

// ── Interview Lifecycle ──
async function startInterview(domain) {
  if (!domain) { alert("Please select or define a target role."); return; }
  setLoading(true, "Preparing your AI panel...");
  
  try {
    const fd = new FormData();
    fd.append('domain', domain);
    fd.append('model_provider', state.provider || 'gemini');
    if (state.resumeFile) {
      fd.append('resume', state.resumeFile);
    }

    const data = await apiFetch('/api/interview/start', {
      method: 'POST',
      body: fd
    });
    
    state.sessionId = data.session_id;
    state.inInterview = true;
    state.questionCount = 1;
    state.lastQuestion = data.reply;
    
    showScreen('interview');
    $('stat-role-info').textContent = `SESSION ACTIVE • ROLE: ${domain.toUpperCase()}`;
    $('chat-messages').innerHTML = ''; 
    
    addTranscriptEntry('interviewer', data.reply);
    setLoading(false);
  } catch (e) {
    setLoading(false);
    alert(`Connection Error: ${e.message}`);
  }
}

function addTranscriptEntry(speaker, text) {
  const container = $('chat-messages');
  if (!container) return;
  const row = document.createElement('div');
  row.className = `msg-row ${speaker === 'interviewer' ? 'ai' : 'user'}`;
  
  const label = speaker === 'interviewer' ? 'Dr. Aris' : 'You';
  const icon = speaker === 'interviewer' ? 'fa-robot' : 'fa-user';
  const color = speaker === 'interviewer' ? 'var(--primary)' : '#fff';
  
  row.innerHTML = `
    <div class="msg-meta"><i class="fas ${icon}" style="color: ${color}; font-size: 0.8rem; margin-right: 4px;"></i> ${label}</div>
    <div class="msg-text">${text}</div>
  `;
  
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;

  if (speaker === 'interviewer') {
    $('current-question-text').innerHTML = `<b>${text}</b>`;
    speak(text);
    $('cam-panel').style.display = 'block';
    CameraModule.start();
  }
}

async function sendAnswer(text) {
  if (!text.trim() || !state.sessionId) return;
  addTranscriptEntry('user', text);
  setLoading(true, 'Analyzing your response...');
  
  try {
    const data = await apiFetch('/api/interview/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: state.sessionId, answer: text })
    });
    setLoading(false);
    addTranscriptEntry('interviewer', data.reply);
    state.questionCount++;
  } catch (e) {
    setLoading(false);
    alert(e.message);
  }
}

async function endInterview() {
  if (!state.sessionId) return;
  setLoading(true, 'Consulting AI for performance feedback...');
  
  try {
    const log = CameraModule.getSecurityLog();
    const data = await apiFetch('/api/interview/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: state.sessionId, security_log: log })
    });
    
    CameraModule.stop();
    state.inInterview = false;
    showScreen('dashboard');
    renderDashboard(data.score, data.reply);
    setLoading(false);
  } catch (e) {
    setLoading(false);
    alert('Oops! Feedback generation failed. Please check your history.');
  }
}

// ── Session Hud Logic ──
let sessionTimerInterval;
function startSessionTimer() {
  let seconds = 0;
  const timerEl = $('session-timer');
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  sessionTimerInterval = setInterval(() => {
    seconds++;
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    if (timerEl) timerEl.textContent = `${mins}:${secs}`;
  }, 1000);
}

function toggleChat() {
  const sidebar = $('sidebar-chat');
  const layout = $('interview-layout');
  if (sidebar && layout) {
    sidebar.classList.toggle('collapsed');
    layout.classList.toggle('collapsed-view');
  }
}

// ── Dashboard Charts ──
let radarChart; 
function renderDashboard(score, summary) {
  const s = score || { overall: 70, technical: 70, problem_solving: 70, communication: 70, clarity: 70, confidence: 70 };
  
  $('dash-overall-badge').textContent = s.overall;
  $('m-tech').textContent = s.technical;
  $('m-prob').textContent = s.problem_solving;
  $('m-comm').textContent = s.communication;
  $('m-clar').textContent = s.clarity;
  $('m-conf').textContent = s.confidence;
  
  $('dash-summary').innerHTML = summary; 

  // Render Lists
  const strengthsCont = $('report-strengths');
  const improvementsCont = $('report-improvements');
  if (strengthsCont) strengthsCont.innerHTML = (s.strengths || []).map(str => `<li>${str}</li>`).join('');
  if (improvementsCont) improvementsCont.innerHTML = (s.improvements || []).map(imp => `<li>${imp}</li>`).join('');

  const ctx = $('radar-chart');
  if (radarChart) radarChart.destroy();
  
  radarChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Technical', 'Problem Solving', 'Communication', 'Clarity', 'Confidence'],
      datasets: [{
        label: 'Candidate Profile',
        data: [s.technical, s.problem_solving, s.communication, s.clarity, s.confidence],
        backgroundColor: 'rgba(42, 140, 244, 0.2)',
        borderColor: '#2a8cf4',
        borderWidth: 3,
        pointBackgroundColor: '#2a8cf4',
        pointRadius: 4
      }]
    },
    options: {
      scales: { 
        r: { 
          min: 0, max: 100, 
          ticks: { display: false },
          grid: { color: 'rgba(0,0,0,0.05)' },
          angleLines: { color: 'rgba(0,0,0,0.05)' },
          pointLabels: { font: { size: 10, weight: '700' } }
        } 
      },
      plugins: { legend: { display: false } },
      animation: { duration: 1500, easing: 'easeOutQuart' }
    }
  });
}

// ── History Screen ──
let currentHistory = [];
async function loadHistory() {
  const container = $('history-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-mini">Retrieving archives...</div>';
  
  try {
    const data = await apiFetch('/api/interview/history');
    currentHistory = data.history || [];
    renderHistoryList();
  } catch (e) {
    container.innerHTML = '<div class="error-msg">Failed to load history.</div>';
  }
}

function renderHistoryList() {
  const container = $('history-list');
  const sortVal = $('history-sort').value;
  
  let logs = [...currentHistory];
  
  // Apply Sort
  if (sortVal === 'newest') logs.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  else if (sortVal === 'oldest') logs.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
  else if (sortVal === 'score_high') logs.sort((a,b) => (b.score?.overall || 0) - (a.score?.overall || 0));
  else if (sortVal === 'score_low') logs.sort((a,b) => (a.score?.overall || 0) - (b.score?.overall || 0));

  if (logs.length === 0) {
    container.innerHTML = '<div class="empty-state">No previous sessions recorded. Start practicing to see results.</div>';
    return;
  }
  
  container.innerHTML = logs.map(l => {
    const date = new Date(l.created_at).toLocaleDateString();
    const score = l.score ? l.score.overall : '--';
    
    let badgeClass = 'low';
    let badgeText = 'Developing';
    if (score >= 90) { badgeClass = 'elite'; badgeText = 'Elite'; }
    else if (score >= 80) { badgeClass = 'adv'; badgeText = 'Advanced'; }
    else if (score >= 70) { badgeClass = 'std'; badgeText = 'Standard'; }

    return `
      <div class="history-item">
        <div class="h-info">
          <span class="h-domain">${l.domain}</span>
          <span class="h-date"><i class="far fa-calendar-alt"></i> ${date}</span>
        </div>
        <div class="h-stats">
           <div class="h-badge ${badgeClass}">${badgeText}</div>
           <div class="h-score">
              <span class="lbl">Score</span>
              <span class="val">${score}</span>
           </div>
        </div>
        <button class="h-btn" onclick="viewDetails('${l.session_id}')">Analysis <i class="fas fa-chevron-right"></i></button>
      </div>
    `;
  }).join('');
}

// Event Listeners for Filters handled in init

window.viewDetails = async (id) => {
  setLoading(true, 'Fetching detailed archive...');
  try {
    const data = await apiFetch(`/api/interview/session/${id}`);
    showScreen('dashboard');
    renderDashboard(data.score, data.summary);
    setLoading(false);
  } catch (e) {
    setLoading(false);
    alert(e.message);
  }
};

// ── Analytics Dashboard (Multi-Interview) ──
let analyticsCharts = { progress: null, radar: null, frequency: null };

async function loadAnalyticsDashboard() {
  setLoading(true, 'Aggregating your career growth data...');
  try {
    const data = await apiFetch('/api/interview/history');
    const logs = data.history || [];
    
    if (logs.length === 0) {
      const g = document.querySelector('.analytics-grid');
      if (g) g.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">No interview data yet. Complete a practice session to see analytics.</div>';
      setLoading(false);
      return;
    }

    // Sort by date ascending
    logs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const labels = logs.map((l, i) => `Session ${i + 1}`);
    const scores = logs.map(l => l.score ? l.score.overall : 0);

    // 1. Progress Line Chart
    const pCtx = $('progress-line-chart');
    if (analyticsCharts.progress) analyticsCharts.progress.destroy();
    analyticsCharts.progress = new Chart(pCtx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Overall Score',
          data: scores,
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79, 70, 229, 0.1)',
          fill: true,
          tension: 0.4
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });

    // 2. Average Radar Chart
    // Fetch detailed sessions to get competency averages
    const detailPromises = logs.slice(-5).map(l => apiFetch(`/api/interview/session/${l.session_id}`));
    const details = await Promise.all(detailPromises).catch(() => []);
    
    const avg = { comm: 0, tech: 0, conf: 0 };
    details.forEach(d => {
      if (d.score) {
        avg.comm += d.score.communication;
        avg.tech += d.score.technical;
        avg.conf += d.score.confidence;
      }
    });
    const count = details.length || 1;
    
    const rCtx = $('averages-radar-chart');
    if (analyticsCharts.radar) analyticsCharts.radar.destroy();
    analyticsCharts.radar = new Chart(rCtx, {
      type: 'radar',
      data: {
        labels: ['Communication', 'Technical', 'Confidence'],
        datasets: [{
          label: 'Avg Competency',
          data: [avg.comm / count, avg.tech / count, avg.conf / count],
          backgroundColor: 'rgba(56, 178, 172, 0.2)',
          borderColor: '#38b2ac',
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });

    // 3. Frequency / Domain Bar Chart
    const domains = {};
    logs.forEach(l => domains[l.domain] = (domains[l.domain] || 0) + 1);
    
    const bCtx = $('frequency-bar-chart');
    if (analyticsCharts.frequency) analyticsCharts.frequency.destroy();
    analyticsCharts.frequency = new Chart(bCtx, {
      type: 'bar',
      data: {
        labels: Object.keys(domains),
        datasets: [{
          label: 'Sessions per Role',
          data: Object.values(domains),
          backgroundColor: '#5a67d8',
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });

    setLoading(false);
  } catch (e) {
    console.error(e);
    setLoading(false);
  }
}

// ── Global Init ──
document.addEventListener('DOMContentLoaded', () => {
  initSTT();
  
  // Navigation
  document.querySelectorAll('.nav-item').forEach(link => {
    link.onclick = (e) => {
      e.preventDefault();
      const target = link.textContent.toLowerCase().trim();
      
      // Update active state
      document.querySelectorAll('.nav-item').forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      if (target === 'dashboard') {
        showScreen('dashboard-analytics');
        loadAnalyticsDashboard();
      } else if (target === 'practice') {
        showScreen('welcome');
      } else if (target === 'history') {
        showScreen('history');
        loadHistory();
      }
    };
  });

  const updateSteps = (n) => {
    document.querySelectorAll('.step').forEach((s, i) => {
      s.classList.toggle('active', i < n);
    });
  };

  // Redesigned Role Logic 2.0
  const categorySelect = $('category-select');
  const roleSelect = $('role-select');
  const customRoleContainer = $('custom-role-container');
  const customRoleInput = $('custom-role-input');
  
  const ROLES_MAP = {
    "Technical": [
      "Software Engineer", "Frontend Developer", "Backend Developer", 
      "Data Scientist", "DevOps Engineer", "Cloud Architect", 
      "AI/ML Engineer", "Cybersecurity Analyst", "Mobile Developer"
    ],
    "Non-Technical": [
      "Product Manager", "HR Manager", "Marketing Lead", 
      "Sales Executive", "Project Manager", "UX Designer", 
      "Financial Analyst", "Operations Manager", "Content Specialist"
    ]
  };

  const populateRoles = (cat) => {
    roleSelect.innerHTML = `<option value="" disabled selected>Select Target Role</option>`;
    roleSelect.innerHTML += ROLES_MAP[cat].map(r => `<option value="${r}">${r}</option>`).join('');
    roleSelect.innerHTML += `<option value="Other">Other / Custom Persona...</option>`;
    updateRoleState();
  };

  const updateRoleState = () => {
    if (roleSelect.value === 'Other') {
      customRoleContainer.style.display = 'block';
      state.domain = customRoleInput.value;
    } else {
      customRoleContainer.style.display = 'none';
      state.domain = roleSelect.value;
    }
  };

  categorySelect.onchange = () => populateRoles(categorySelect.value);
  roleSelect.onchange = updateRoleState;
  customRoleInput.oninput = updateRoleState;

  // Initialize - Clear role select until category is picked
  roleSelect.innerHTML = `<option value="" disabled selected>Select Target Role</option>`;
  state.provider = 'gemini'; // Assigned internally as per request

  // Resume Upload Logic
  const resumeUpload = $('resume-upload');
  const resumeDropzone = $('resume-dropzone');
  const fileInfo = $('file-info');
  const filenameText = $('filename-text');

  resumeDropzone.onclick = () => resumeUpload.click();
  
  resumeUpload.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      state.resumeFile = file;
      filenameText.textContent = file.name;
      fileInfo.style.display = 'flex';
      resumeDropzone.style.borderColor = '#10b981';
    }
  };

  // Drag and Drop
  resumeDropzone.ondragover = (e) => { e.preventDefault(); resumeDropzone.style.borderColor = 'var(--primary)'; };
  resumeDropzone.ondragleave = () => { resumeDropzone.style.borderColor = 'var(--border)'; };
  resumeDropzone.ondrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      state.resumeFile = file;
      filenameText.textContent = file.name;
      fileInfo.style.display = 'flex';
      resumeDropzone.style.borderColor = '#10b981';
    }
  };

  // Navigation Update: Close sidebar on practice start
  $('start-btn').onclick = () => {
    const sidebar = $('sidebar-chat');
    const layout = $('interview-layout');
    if (sidebar) sidebar.classList.add('collapsed');
    if (layout) layout.classList.add('collapsed-view');
    startInterview(state.domain);
    startSessionTimer();
  };

  $('mic-btn').onclick = () => recognition ? recognition.start() : alert('Microphone unavailable.');
  $('chat-toggle-btn').onclick = toggleChat;
  
  // New Interactive Buttons (Refined for Dock)
  $('repeat-btn').onclick = () => {
    if (state.lastQuestion) {
       speak(state.lastQuestion);
       addTranscriptEntry('interviewer', `<i>(Repeating)</i> ${state.lastQuestion}`);
    }
  };

  $('clarify-btn').onclick = async () => {
    if (!state.sessionId) return;
    setLoading(true, 'Asking Dr. Aris for clarification...');
    try {
      const data = await apiFetch('/api/interview/clarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: state.sessionId })
      });
      addTranscriptEntry('interviewer', data.reply);
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const handleChatSend = () => {
    const input = $('chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (text && state.sessionId) {
      sendAnswer(text);
      input.value = '';
    }
  };

  const chatSendBtn = $('chat-send-btn');
  if (chatSendBtn) {
    chatSendBtn.onclick = handleChatSend;
  }
  
  const chatInput = $('chat-input');
  if (chatInput) {
    chatInput.onkeypress = (e) => {
      if (e.key === 'Enter') handleChatSend();
    };
  }

  let camOn = true;
  $('cam-toggle').onclick = () => {
    camOn = !camOn;
    $('cam-toggle').classList.toggle('active', camOn);
    $('cam-panel').style.opacity = camOn ? '1' : '0.1';
    if (camOn) CameraModule.start();
    else CameraModule.stop();
  };

  $('sidebar-end').onclick = () => {
    $('modal-confirm-end').style.display = 'flex';
  };
  
  $('btn-cancel-end').onclick = () => {
    $('modal-confirm-end').style.display = 'none';
  };
  
  $('btn-confirm-end').onclick = () => {
    $('modal-confirm-end').style.display = 'none';
    endInterview();
  };
  
  CameraModule.init({});
  
  // Initial screen
  showScreen('welcome');

  // History Filter Refresh
  const historySort = $('history-sort');
  if (historySort) historySort.onchange = renderHistoryList;
});

// Update state tracking in addTranscriptEntry
const originalAddTranscriptEntry = addTranscriptEntry;
addTranscriptEntry = (speaker, text) => {
  if (speaker === 'interviewer') state.lastQuestion = text;
  originalAddTranscriptEntry(speaker, text);
};
