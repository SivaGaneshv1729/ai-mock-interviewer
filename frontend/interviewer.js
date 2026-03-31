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
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('visible'));
  const target = $(`screen-${screenId}`);
  if (target) target.classList.add('visible');
  
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
  setLoading(true, 'Setting up your interview room...');
  state.domain = domain;
  state.questionCount = 0;
  
  try {
    const fd = new FormData();
    fd.append('domain', domain);
    fd.append('model_provider', state.provider);

    const data = await apiFetch('/api/interview/start', { method: 'POST', body: fd });
    
    state.sessionId = data.session_id;
    state.inInterview = true;
    state.questionCount = 1;
    
    showScreen('interview');
    $('stat-domain').textContent = domain.toUpperCase();
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
  
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const label = speaker === 'interviewer' ? 'DR. ARIS' : 'YOU';
  
  row.innerHTML = `<div class="msg-meta">${label} <span class="time">${time}</span></div><div class="msg-text">${text}</div>`;
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;

  if (speaker === 'interviewer') {
    $('current-question-text').textContent = text;
    speak(text);
    // Camera feed check
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

// ── Dashboard Charts ──
let radarChart; 
function renderDashboard(score, summary) {
  const s = score || { overall: 75, communication: 75, technical: 75, confidence: 75 };
  
  $('dash-overall-badge').textContent = s.overall;
  $('dash-summary').innerHTML = summary; 

  const ctx = $('radar-chart');
  if (radarChart) radarChart.destroy();
  
  radarChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Communication', 'Technical', 'Confidence'],
      datasets: [{
        label: 'Aptitude Profile',
        data: [s.communication, s.technical, s.confidence],
        backgroundColor: 'rgba(90, 103, 216, 0.1)',
        borderColor: '#5a67d8',
        borderWidth: 2,
        pointBackgroundColor: '#5a67d8',
      }]
    },
    options: {
      scales: { r: { min: 0, max: 100, ticks: { stepSize: 20 } } },
      plugins: { legend: { display: false } }
    }
  });
}

// ── History Screen ──
async function loadHistory() {
  const container = $('history-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-mini">Retrieving archives...</div>';
  
  try {
    const data = await apiFetch('/api/interview/history');
    const logs = data.history || [];
    
    if (logs.length === 0) {
      container.innerHTML = '<div class="empty-state">No previous sessions recorded. Start practicing to see results.</div>';
      return;
    }
    
    container.innerHTML = logs.map(l => {
      const date = new Date(l.created_at).toLocaleDateString();
      const score = l.score ? l.score.overall : '--';
      return `
        <div class="history-item">
          <div class="h-info">
            <span class="h-domain">${l.domain}</span>
            <span class="h-date">${date}</span>
          </div>
          <div class="h-score">
             <span class="lbl">Score</span>
             <span class="val">${score}</span>
          </div>
          <button class="h-btn" onclick="viewDetails('${l.session_id}')">View Report</button>
        </div>
      `;
    }).join('');
  } catch (e) {
    container.innerHTML = '<div class="error-msg">Failed to load history.</div>';
  }
}

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
      document.getElementById('analytics-insights').innerHTML = '<div class="empty-state">No interview data yet. Complete a practice session to see analytics.</div>';
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
      }
    };
  });

  // Start Screen UI
  const roleButtons = document.querySelectorAll('.role-btn');
  roleButtons.forEach(btn => {
    btn.onclick = () => {
      roleButtons.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.domain = btn.dataset.domain;
    };
  });

  $('start-btn').onclick = () => startInterview(state.domain);
  $('mic-btn').onclick = () => recognition ? recognition.start() : alert('Microphone unavailable.');
  $('sidebar-end').onclick = endInterview;
  
  CameraModule.init({});
  
  // Initial screen
  showScreen('welcome');
});
