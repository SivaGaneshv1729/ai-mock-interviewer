/* ─────────────────────────────────────────
   camera.js — Face Detection · Emotion Analysis · Cheat Detection
   Uses @vladmandic/face-api (TensorFlow.js based, runs 100% client-side)
   Requires face-api.js loaded before this script.
───────────────────────────────────────── */

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model';

const CameraModule = (() => {
  /* ── Private State ── */
  let video    = null;
  let canvas   = null;
  let stream   = null;
  let active   = false;
  let modelsLoaded = false;
  let detectionLoop = null;

  // Cheat & security
  const securityLog  = [];
  const recentEvents = {};   // type → last timestamp (for debounce)
  const DEBOUNCE_MS  = 20000; // 20s between same-type events

  // Face absence tracking
  let faceAbsentSince = null;
  const ABSENT_THRESHOLD_MS = 4000;

  // Emotion history
  const emotionHistory = [];

  // Callbacks (set by host)
  let onSecurityEvent = null;
  let onEmotionUpdate = null;
  let onStatusChange  = null;

  /* ── Helpers ── */
  function now() { return new Date().toISOString(); }

  function logEvent(type, extra = {}) {
    const lastTime = recentEvents[type] || 0;
    if (Date.now() - lastTime < DEBOUNCE_MS) return;
    recentEvents[type] = Date.now();

    const event = { type, timestamp: now(), ...extra };
    securityLog.push(event);
    if (onSecurityEvent) onSecurityEvent(event);
    updateSecurityPanel();
  }

  function setStatus(msg, cls = '') {
    const el = document.getElementById('cam-status');
    if (el) { el.textContent = msg; el.className = `cam-status ${cls}`; }
    if (onStatusChange) onStatusChange(msg, cls);
  }

  function updateSecurityPanel() {
    const el = document.getElementById('security-event-list');
    if (!el) return;

    const icons = {
      multiple_faces: '👥', face_not_detected: '👁️', tab_switch: '🔄',
      paste_attempt: '📋', copy_attempt: '📋', right_click: '🖱️',
      key_shortcut: '⌨️'
    };
    const labels = {
      multiple_faces: 'Multiple faces detected',
      face_not_detected: 'Face not in frame',
      tab_switch: 'Tab / window switch',
      paste_attempt: 'Paste attempt',
      copy_attempt: 'Copy attempt',
      right_click: 'Right-click blocked',
      key_shortcut: 'Dev shortcut blocked',
    };

    const badges = { high: 'High', medium: 'Medium', low: 'Low' };
    const total  = securityLog.length;

    // Update integrity score
    const integrityEl = document.getElementById('integrity-score');
    const integrity   = Math.max(0, 100 - total * 8);
    if (integrityEl) {
      integrityEl.textContent = integrity;
      integrityEl.className   = 'integrity-num ' + (integrity >= 80 ? 'high' : integrity >= 60 ? 'mid' : 'low');
    }
    const integrityBar = document.getElementById('integrity-bar');
    if (integrityBar) {
      integrityBar.style.width = `${integrity}%`;
      integrityBar.className = 'integrity-fill ' + (integrity >= 80 ? 'good' : integrity >= 60 ? 'mid' : 'bad');
    }

    if (securityLog.length === 0) {
      el.innerHTML = '<li class="no-events">✅ No security events detected</li>';
      return;
    }
    el.innerHTML = securityLog.slice(-8).reverse().map(e => {
      const time = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const icon = icons[e.type] || '⚠️';
      const label = labels[e.type] || e.type;
      return `<li class="sec-event"><span class="sec-icon">${icon}</span><span class="sec-label">${label}</span><span class="sec-time">${time}</span></li>`;
    }).join('');
  }

  /* ── Model Loading ── */
  async function loadModels() {
    if (modelsLoaded) return;
    setStatus('Loading AI models…', 'loading');
    try {
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
      modelsLoaded = true;
      setStatus('Camera ready', 'ready');
    } catch (e) {
      console.warn('[CameraModule] Model load failed:', e);
      setStatus('Models unavailable', 'error');
    }
  }

  /* ── Detection Loop ── */
  async function detectFrame() {
    if (!active || !video || video.readyState < 2) return;

    try {
      const detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.4 }))
        .withFaceExpressions();

      const count = detections.length;

      // Draw overlay on canvas
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const dims = faceapi.matchDimensions(canvas, video, true);
        const resized = faceapi.resizeResults(detections, dims);
        resized.forEach(d => {
          const box = d.detection.box;
          ctx.strokeStyle = count > 1 ? '#ef4444' : '#6366f1';
          ctx.lineWidth = 2;
          ctx.strokeRect(box.x, box.y, box.width, box.height);
        });
      }

      // ── Event: Multiple faces ──
      if (count > 1) {
        logEvent('multiple_faces', { count });
      }

      // ── Face absence tracking ──
      if (count === 0) {
        if (!faceAbsentSince) faceAbsentSince = Date.now();
        if (Date.now() - faceAbsentSince > ABSENT_THRESHOLD_MS) {
          logEvent('face_not_detected', { seconds: Math.round((Date.now() - faceAbsentSince) / 1000) });
          faceAbsentSince = null;
        }
        updateEmotionBadge(null);
        if (onEmotionUpdate) onEmotionUpdate('away', 0);
      } else {
        faceAbsentSince = null;
        const expressions = detections[0].expressions;
        const [topEmotion, topScore] = Object.entries(expressions)
          .sort((a, b) => b[1] - a[1])[0];

        emotionHistory.push({ emotion: topEmotion, score: topScore, ts: Date.now() });
        if (emotionHistory.length > 200) emotionHistory.shift();

        updateEmotionBadge(topEmotion, topScore, expressions);
        if (onEmotionUpdate) onEmotionUpdate(topEmotion, topScore);
      }
    } catch (_) { /* silent — canvas might be stale */ }
  }

  const EMOTION_EMOJI = { happy: '😊', neutral: '😐', surprised: '😲', fearful: '😰', angry: '😠', disgusted: '🤢', sad: '😢' };

  function updateEmotionBadge(emotion, score, expressions) {
    const badge = document.getElementById('emotion-badge');
    if (!badge) return;
    if (!emotion) {
      badge.textContent = '👁️ Away';
      badge.className = 'emotion-badge away';
      return;
    }
    const emoji = EMOTION_EMOJI[emotion] || '😐';
    const label = emotion.charAt(0).toUpperCase() + emotion.slice(1);
    badge.textContent = `${emoji} ${label}`;
    badge.className = `emotion-badge ${emotion}`;

    // Update mini bar chart
    if (expressions) updateEmotionBars(expressions);
  }

  function updateEmotionBars(expressions) {
    const container = document.getElementById('emotion-bars');
    if (!container) return;
    const entries = Object.entries(expressions).sort((a, b) => b[1] - a[1]).slice(0, 4);
    container.innerHTML = entries.map(([em, sc]) => {
      const pct = Math.round(sc * 100);
      return `<div class="emo-bar-row">
        <span class="emo-bar-label">${EMOTION_EMOJI[em] || '😐'} ${em}</span>
        <div class="emo-bar-track"><div class="emo-bar-fill ${em}" style="width:${pct}%"></div></div>
        <span class="emo-bar-pct">${pct}%</span>
      </div>`;
    }).join('');
  }

  /* ── Anti-Cheat Browser Events ── */
  function attachBrowserMonitors() {
    // Tab / window switch
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) logEvent('tab_switch');
    });

    // Paste
    document.addEventListener('paste', () => {
      if (window._interviewActive) logEvent('paste_attempt');
    });

    // Copy
    document.addEventListener('copy', () => {
      if (window._interviewActive) logEvent('copy_attempt');
    });

    // Right-click block
    document.addEventListener('contextmenu', e => {
      if (window._interviewActive) {
        e.preventDefault();
        logEvent('right_click');
      }
    });

    // Dev shortcuts — F12, Ctrl+Shift+I, Ctrl+U
    document.addEventListener('keydown', e => {
      if (!window._interviewActive) return;
      const isDevKey = e.key === 'F12' ||
        (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key)) ||
        (e.ctrlKey && e.key === 'u');
      if (isDevKey) {
        e.preventDefault();
        logEvent('key_shortcut', { key: e.key });
      }
    });
  }

  /* ── Public API ── */
  return {
    /* Initialize — call once on page load */
    async init(opts = {}) {
      onSecurityEvent = opts.onSecurityEvent || null;
      onEmotionUpdate = opts.onEmotionUpdate || null;
      onStatusChange  = opts.onStatusChange  || null;
      attachBrowserMonitors();
      updateSecurityPanel();
      setStatus('Click "Enable Camera" to start', '');
    },

    /* Start camera + detection — call when interview begins */
    async start() {
      video  = document.getElementById('cam-video');
      canvas = document.getElementById('cam-canvas');
      if (!video) return;

      setStatus('Requesting camera…', 'loading');

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 280 }, height: { ideal: 210 }, facingMode: 'user' },
          audio: false
        });
        video.srcObject = stream;
        await video.play();
        active = true;

        // Show camera panel
        const panel = document.getElementById('cam-panel');
        if (panel) panel.style.display = 'flex';

        await loadModels();

        if (modelsLoaded) {
          // Run detection every 1.5s
          detectionLoop = setInterval(() => detectFrame(), 1500);
          setStatus('🔴 Live', 'live');
        } else {
          // Fallback: just show feed without analysis
          setStatus('📷 Camera on (no AI)', 'ready');
        }
      } catch (e) {
        if (e.name === 'NotAllowedError') setStatus('Camera denied', 'error');
        else setStatus('Camera unavailable', 'error');
        console.warn('[CameraModule] Camera error:', e);
      }
    },

    /* Stop camera + detection — call when interview ends or page changes */
    stop() {
      active = false;
      clearInterval(detectionLoop);
      detectionLoop = null;
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      if (video)  { video.srcObject = null; }
      faceAbsentSince = null;
      const panel = document.getElementById('cam-panel');
      if (panel) panel.style.display = 'none';
      setStatus('Camera off', '');
    },

    /* Returns security log array (to send to backend on end) */
    getSecurityLog() { return [...securityLog]; },

    /* Returns emotion frequency summary */
    getEmotionSummary() {
      if (!emotionHistory.length) return [];
      const counts = {};
      emotionHistory.forEach(h => counts[h.emotion] = (counts[h.emotion] || 0) + 1);
      return Object.entries(counts)
        .map(([emotion, n]) => ({ emotion, pct: Math.round(n / emotionHistory.length * 100) }))
        .sort((a, b) => b.pct - a.pct);
    },

    /* Returns computed integrity score */
    getIntegrity() {
      return Math.max(0, 100 - securityLog.length * 8);
    },

    /* Reset for a new session */
    reset() {
      securityLog.length    = 0;
      emotionHistory.length = 0;
      Object.keys(recentEvents).forEach(k => delete recentEvents[k]);
      updateSecurityPanel();
    },
  };
})();
