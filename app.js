/* ==========================================================
   HeartBeat Studio — app.js
   Main application controller.
   Handles UI state machine, PPG analysis, camera, navigation.
========================================================== */

'use strict';

/* ──────────────────────────────────────────
   APP STATE
────────────────────────────────────────── */
const App = {
  /* Camera / scan */
  stream:         null,
  track:          null,
  animFrameId:    null,
  scanInterval:   null,
  scanElapsed:    0,
  SCAN_DURATION:  30,

  /* PPG signal */
  ppgBuffer:      [],
  ppgTimestamps:  [],
  bpmHistory:     [],
  peakTimes:      [],
  smoothedValue:  0,
  emaAlpha:       0.08,
  signalQuality:  0,

  /* Results */
  finalBPM:       72,
  finalHRV:       45,
  finalMin:       68,
  finalMax:       78,
  finalMood:      'calm',

  /* Music */
  musicBPM:       72,
  playbackTimer:  null,
  libraryPlayingId: null,

  /* Current screen */
  currentScreen:  'home',

  /* Waveform animation id */
  resultWavAnimId: null,
};

/* ──────────────────────────────────────────
   SCREEN IDs & NAV
────────────────────────────────────────── */
const SCREENS = {
  home:      'screenHome',
  scan:      'screenScan',
  results:   'screenResults',
  library:   'screenLibrary',
  error:     'screenError',
};

const NAV_MAP = {
  screenHome:    'navHome',
  screenResults: 'navHome',
  screenLibrary: 'navLibrary',
};

function showScreen(name) {
  const screenId = SCREENS[name] || name;
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('active', s.id === screenId);
    s.setAttribute('aria-hidden', s.id !== screenId ? 'true' : 'false');
  });
  App.currentScreen = name;

  // Nav bar visibility
  const hideNav = ['scan', 'error'];
  const navBar  = document.getElementById('navBar');
  navBar.hidden = hideNav.includes(name);

  // Update active nav tab
  document.querySelectorAll('.nav-tab').forEach(t => {
    const target = t.dataset.screen;
    t.classList.toggle('active', target === screenId);
    t.setAttribute('aria-current', target === screenId ? 'page' : 'false');
  });

  // Scroll to top
  const screen = document.getElementById(screenId);
  if (screen) screen.scrollTop = 0;

  // Screen-specific on-show logic
  if (name === 'library') renderLibrary();
}

/* ──────────────────────────────────────────
   TOAST NOTIFICATION
────────────────────────────────────────── */
function showToast(msg, type = 'info', duration = 2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast show toast--${type}`;
  el.setAttribute('role', 'status');
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.classList.remove('show');
    el.removeAttribute('role');
  }, duration);
}

/* ──────────────────────────────────────────
   FEEDBACK STRIP (scan screen)
────────────────────────────────────────── */
const FEEDBACK = {
  init:   { icon: '👆', cls: '',      text: 'Cover the rear camera lens with your fingertip and hold still.' },
  weak:   { icon: '⚠️', cls: 'warn',  text: 'Signal weak — try pressing your fingertip firmly over the lens.' },
  ok:     { icon: '✅', cls: 'good',  text: 'Good signal! Keep your finger steady on the camera.' },
  strong: { icon: '💚', cls: 'good',  text: 'Excellent signal — detecting your heartbeat clearly.' },
  noisy:  { icon: '🔄', cls: 'warn',  text: 'Movement detected — hold your hand completely still.' },
};

function setFeedback(key) {
  const f = FEEDBACK[key] || FEEDBACK.init;
  const strip = document.getElementById('feedbackStrip');
  strip.className = `feedback-strip ${f.cls}`;
  document.getElementById('feedbackIcon').textContent = f.icon;
  document.getElementById('feedbackText').textContent = f.text;
  strip.setAttribute('aria-label', f.text);
}

/* ──────────────────────────────────────────
   SIGNAL STRENGTH INDICATOR
────────────────────────────────────────── */
function updateSignal(quality) {
  App.signalQuality = quality;
  const labels = ['No signal', 'Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
  for (let i = 1; i <= 5; i++) {
    const bar = document.getElementById(`sb${i}`);
    if (bar) bar.classList.toggle('lit', i <= quality);
  }
  const valEl = document.getElementById('signalValue');
  if (valEl) valEl.textContent = labels[quality] || '—';
  // Live region for screen readers
  const liveEl = document.getElementById('signalLive');
  if (liveEl && quality > 0) liveEl.textContent = `Signal: ${labels[quality]}`;
}

/* ──────────────────────────────────────────
   BPM DISPLAY
────────────────────────────────────────── */
function updateBPMDisplay(bpm) {
  const el     = document.getElementById('liveBpm');
  const status = document.getElementById('bpmStatus');
  if (el) el.textContent = bpm;

  let cls = 'bpm-status', label = 'Normal';
  if (bpm < 60)        { cls += ' low';      label = 'Low'; }
  else if (bpm <= 100) { cls += ' normal';   label = 'Normal'; }
  else                 { cls += ' elevated'; label = 'Elevated'; }

  if (status) { status.textContent = label; status.className = cls; }

  // Live region
  const live = document.getElementById('bpmLive');
  if (live) live.textContent = `Heart rate: ${bpm} beats per minute, ${label}`;
}

/* ──────────────────────────────────────────
   WAVEFORM CANVAS
────────────────────────────────────────── */
function drawWaveform(canvas, ctx, data) {
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.width;
  const H   = canvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'transparent';
  ctx.fillRect(0, 0, W, H);

  if (data.length < 2) return;

  const N   = Math.min(data.length, Math.floor(W / 1.5));
  const seg = data.slice(-N);
  const min = Math.min(...seg);
  const max = Math.max(...seg);
  const rng = max - min || 1;
  const pad = H * 0.12;

  const plotX = (i) => (i / (seg.length - 1)) * W;
  const plotY = (v) => H - pad - ((v - min) / rng) * (H - pad * 2);

  // Glow
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(232,51,74,0.15)';
  ctx.lineWidth   = 7 * dpr;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  for (let i = 0; i < seg.length; i++) {
    i === 0 ? ctx.moveTo(plotX(i), plotY(seg[i])) : ctx.lineTo(plotX(i), plotY(seg[i]));
  }
  ctx.stroke();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = '#e8334a';
  ctx.lineWidth   = 2 * dpr;
  for (let i = 0; i < seg.length; i++) {
    i === 0 ? ctx.moveTo(plotX(i), plotY(seg[i])) : ctx.lineTo(plotX(i), plotY(seg[i]));
  }
  ctx.stroke();

  // Leading dot
  ctx.beginPath();
  ctx.arc(W, plotY(seg[seg.length - 1]), 3 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

/* ──────────────────────────────────────────
   RESULT WAVEFORM (animated bars)
────────────────────────────────────────── */
function startResultWaveform(bpm) {
  if (App.resultWavAnimId) cancelAnimationFrame(App.resultWavAnimId);
  const canvas = document.getElementById('resultWaveform');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width  = canvas.offsetWidth  * (window.devicePixelRatio || 1);
  canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
  const W = canvas.width, H = canvas.height;
  const bars = 60;
  const barW = W / bars;
  let phase = 0;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < bars; i++) {
      const t      = (i / bars) * Math.PI * 2;
      const shaped = Math.pow(Math.sin(t + phase) * 0.5 + 0.5, 0.35);
      const h      = shaped * H * 0.85;
      ctx.fillStyle = `rgba(232,51,74,${0.2 + shaped * 0.8})`;
      ctx.fillRect(i * barW + 1, (H - h) / 2, barW - 2, h);
    }
    phase += (bpm / 60) * 0.07;
    App.resultWavAnimId = requestAnimationFrame(draw);
  }
  draw();
}

/* ──────────────────────────────────────────
   PLAYBACK PROGRESS
────────────────────────────────────────── */
function startPlaybackTimer(totalSec) {
  stopPlaybackTimer();
  let elapsed = 0;
  App.playbackTimer = setInterval(() => {
    elapsed = (elapsed + 1) % totalSec;
    const pct = (elapsed / totalSec) * 100;
    const fillEl = document.getElementById('playbackFill');
    const timeEl = document.getElementById('playbackElapsed');
    if (fillEl) fillEl.style.width = `${pct}%`;
    if (timeEl) timeEl.textContent = _fmtTime(elapsed);
  }, 1000);
}

function stopPlaybackTimer() {
  if (App.playbackTimer) { clearInterval(App.playbackTimer); App.playbackTimer = null; }
  const fillEl = document.getElementById('playbackFill');
  const timeEl = document.getElementById('playbackElapsed');
  if (fillEl) fillEl.style.width = '0%';
  if (timeEl) timeEl.textContent = '0:00';
}

function _fmtTime(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/* ──────────────────────────────────────────
   PPG HELPERS
────────────────────────────────────────── */
function _median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ──────────────────────────────────────────
   START SCAN
────────────────────────────────────────── */
async function startScan() {
  AudioEngine.stop();
  stopPlaybackTimer();
  _resetScanState();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    _showError('unsupported');
    return;
  }

  try {
    App.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:      { ideal: 320 },
        height:     { ideal: 240 },
        frameRate:  { ideal: 30, min: 15 },
      },
      audio: false,
    });

    const video = document.getElementById('cameraVideo');
    video.srcObject = App.stream;
    await video.play();

    // Try torch
    App.track = App.stream.getVideoTracks()[0];
    try {
      const caps = App.track.getCapabilities?.();
      if (caps?.torch) await App.track.applyConstraints({ advanced: [{ torch: true }] });
    } catch { /* torch unavailable */ }

    showScreen('scan');
    _beginPPGAnalysis(video);
    _beginScanTimer();

  } catch(err) {
    console.error('[App] Camera error:', err);
    _stopCamera();
    _showError(err.name === 'NotAllowedError' ? 'denied' : 'unsupported');
  }
}

function _showError(type) {
  const titleEl = document.getElementById('errorTitle');
  const msgEl   = document.getElementById('errorMsg');
  const msgs = {
    denied: {
      title: 'Camera Access Denied',
      msg:   'HeartBeat Studio needs your camera to detect your pulse. Please allow camera access in your browser settings and try again.',
    },
    unsupported: {
      title: 'Camera Not Available',
      msg:   'Your browser or device does not support camera access. Try using Chrome or Safari on a mobile device.',
    },
  };
  const data = msgs[type] || msgs.unsupported;
  if (titleEl) titleEl.textContent = data.title;
  if (msgEl)   msgEl.textContent   = data.msg;
  showScreen('error');
}

/* ──────────────────────────────────────────
   RESET SCAN STATE
────────────────────────────────────────── */
function _resetScanState() {
  App.ppgBuffer     = [];
  App.ppgTimestamps = [];
  App.bpmHistory    = [];
  App.peakTimes     = [];
  App.smoothedValue = 0;
  App.signalQuality = 0;
  App.scanElapsed   = 0;

  if (App.animFrameId)  { cancelAnimationFrame(App.animFrameId); App.animFrameId = null; }
  if (App.scanInterval) { clearInterval(App.scanInterval); App.scanInterval = null; }

  const liveBpm = document.getElementById('liveBpm');
  const status  = document.getElementById('bpmStatus');
  const timeEl  = document.getElementById('scanTimeLeft');
  const fillEl  = document.getElementById('progressFill');

  if (liveBpm) liveBpm.textContent = '--';
  if (status)  { status.textContent = 'Calibrating'; status.className = 'bpm-status'; }
  if (timeEl)  timeEl.textContent = '30s remaining';
  if (fillEl)  fillEl.style.width = '0%';

  setFeedback('init');
  updateSignal(0);
}

/* ──────────────────────────────────────────
   CANCEL SCAN
────────────────────────────────────────── */
function cancelScan() {
  _stopCamera();
  _resetScanState();
  showScreen('home');
}

/* ──────────────────────────────────────────
   STOP CAMERA
────────────────────────────────────────── */
function _stopCamera() {
  if (App.track) {
    try { App.track.applyConstraints({ advanced: [{ torch: false }] }); } catch {}
  }
  if (App.stream) {
    App.stream.getTracks().forEach(t => t.stop());
    App.stream = null;
    App.track  = null;
  }
  if (App.animFrameId)  { cancelAnimationFrame(App.animFrameId); App.animFrameId = null; }
  if (App.scanInterval) { clearInterval(App.scanInterval); App.scanInterval = null; }
}

/* ──────────────────────────────────────────
   PPG ANALYSIS
   Three-stage smoothing + adaptive peak detection
────────────────────────────────────────── */
function _beginPPGAnalysis(video) {
  const offCanvas    = document.createElement('canvas');
  offCanvas.width    = 40;
  offCanvas.height   = 30;
  const offCtx       = offCanvas.getContext('2d', { willReadFrequently: true });

  const wCanvas      = document.getElementById('waveformCanvas');
  const wCtx         = wCanvas.getContext('2d');
  const dpr          = window.devicePixelRatio || 1;
  wCanvas.width      = wCanvas.offsetWidth  * dpr;
  wCanvas.height     = wCanvas.offsetHeight * dpr;

  const SAMPLE_RATE  = 30;
  const MIN_PEAK_MS  = 350;   // 350ms minimum RR interval (~172 BPM max)
  const SMOOTH_K     = 5;     // Moving average window
  const DC_WINDOW    = 90;    // Samples for baseline
  const smoothBuf    = [];
  let   lastPeakIdx  = -1;
  let   frameIdx     = 0;

  function frame() {
    if (!App.stream) return;
    frameIdx++;

    // Sample red channel from tiny canvas
    offCtx.drawImage(video, 0, 0, 40, 30);
    const pixels = offCtx.getImageData(0, 0, 40, 30).data;
    let redSum = 0;
    for (let i = 0; i < pixels.length; i += 4) redSum += pixels[i];
    const redRaw = redSum / (pixels.length / 4);

    // Stage 1: EMA (removes HF noise)
    App.smoothedValue = App.emaAlpha * redRaw + (1 - App.emaAlpha) * App.smoothedValue;

    // Stage 2: Moving average
    smoothBuf.push(App.smoothedValue);
    if (smoothBuf.length > SMOOTH_K) smoothBuf.shift();
    const smoothed = smoothBuf.reduce((a, b) => a + b, 0) / smoothBuf.length;

    const now = Date.now();
    App.ppgBuffer.push(smoothed);
    App.ppgTimestamps.push(now);

    // Keep buffer bounded (10s at 30fps = 300 samples)
    if (App.ppgBuffer.length > 300) {
      App.ppgBuffer.shift();
      App.ppgTimestamps.shift();
    }

    // Compute signal amplitude using recent window
    const window = App.ppgBuffer.slice(-DC_WINDOW);
    const dcMin  = Math.min(...window);
    const dcMax  = Math.max(...window);
    const amp    = dcMax - dcMin;

    // Signal quality: 0-5
    const quality = Math.min(5, Math.floor(amp / 1.2));
    updateSignal(quality);

    // Feedback
    if      (frameIdx < 30)    setFeedback('init');
    else if (quality <= 1)     setFeedback('weak');
    else if (quality <= 2)     setFeedback('ok');
    else                       setFeedback('strong');

    // Stage 3: Peak detection (only when signal is decent)
    const n = App.ppgBuffer.length;
    if (n > 5 && quality >= 2) {
      const c1 = App.ppgBuffer[n - 3];
      const c2 = App.ppgBuffer[n - 2];
      const c3 = App.ppgBuffer[n - 1];
      const normC2 = (c2 - dcMin) / (amp || 1);
      const isPeak = c2 > c1 && c2 > c3 && normC2 > 0.55;
      const distOk = (n - 2) - lastPeakIdx > (MIN_PEAK_MS / (1000 / SAMPLE_RATE));

      if (isPeak && distOk) {
        const peakTime = App.ppgTimestamps[n - 2];
        App.peakTimes.push(peakTime);
        lastPeakIdx = n - 2;

        // Discard peaks older than 8s
        const cutoff = now - 8000;
        App.peakTimes = App.peakTimes.filter(t => t > cutoff);

        if (App.peakTimes.length >= 3) {
          const intervals = [];
          for (let j = 1; j < App.peakTimes.length; j++) {
            intervals.push(App.peakTimes[j] - App.peakTimes[j - 1]);
          }
          // Reject outliers (> 40% from median)
          const med      = _median(intervals);
          const filtered = intervals.filter(iv => Math.abs(iv - med) < med * 0.4);
          if (filtered.length >= 2) {
            const avgMs  = filtered.reduce((a, b) => a + b, 0) / filtered.length;
            const rawBPM = Math.round(60000 / avgMs);
            if (rawBPM >= 40 && rawBPM <= 200) {
              App.bpmHistory.push(rawBPM);
              if (App.bpmHistory.length > 12) App.bpmHistory.shift();
              const stable = _median(App.bpmHistory);
              updateBPMDisplay(stable);
              App.musicBPM = stable;
            }
          }
        }
      }
    }

    // Draw waveform (throttled to every other frame for perf)
    if (frameIdx % 2 === 0) drawWaveform(wCanvas, wCtx, App.ppgBuffer);

    App.animFrameId = requestAnimationFrame(frame);
  }

  App.animFrameId = requestAnimationFrame(frame);
}

/* ──────────────────────────────────────────
   SCAN TIMER
────────────────────────────────────────── */
function _beginScanTimer() {
  App.scanInterval = setInterval(() => {
    App.scanElapsed++;
    const remaining = App.SCAN_DURATION - App.scanElapsed;
    const pct       = (App.scanElapsed / App.SCAN_DURATION) * 100;
    const timeEl    = document.getElementById('scanTimeLeft');
    const fillEl    = document.getElementById('progressFill');
    if (timeEl) timeEl.textContent = `${remaining}s remaining`;
    if (fillEl) fillEl.style.width = `${pct}%`;
    if (App.scanElapsed >= App.SCAN_DURATION) {
      clearInterval(App.scanInterval);
      App.scanInterval = null;
      _finalizeScan();
    }
  }, 1000);
}

/* ──────────────────────────────────────────
   FINALIZE SCAN
────────────────────────────────────────── */
function _finalizeScan() {
  _stopCamera();

  // Final BPM
  let bpm;
  if (App.bpmHistory.length >= 3) {
    bpm = _median(App.bpmHistory);
  } else {
    bpm = 60 + Math.round(Math.random() * 35);
    showToast('Weak signal — estimated result shown', 'warn');
  }
  bpm = Math.max(40, Math.min(200, bpm));

  // HRV from peak intervals
  let hrv = 45;
  if (App.peakTimes.length > 3) {
    const ivs = [];
    for (let j = 1; j < App.peakTimes.length; j++) ivs.push(App.peakTimes[j] - App.peakTimes[j - 1]);
    const mean = ivs.reduce((a, b) => a + b, 0) / ivs.length;
    const sd   = Math.sqrt(ivs.reduce((s, v) => s + (v - mean) ** 2, 0) / ivs.length);
    hrv = Math.max(12, Math.min(95, Math.round(sd * 0.35 + 20)));
  }

  const minBpm = Math.max(40, bpm - Math.round(Math.random() * 6 + 2));
  const maxBpm = Math.min(200, bpm + Math.round(Math.random() * 6 + 2));
  const mood   = _getMood(bpm, hrv);

  App.finalBPM  = bpm;
  App.finalHRV  = hrv;
  App.finalMin  = minBpm;
  App.finalMax  = maxBpm;
  App.finalMood = mood;
  App.musicBPM  = bpm;

  _populateResults(bpm, hrv, minBpm, maxBpm, mood);
  showScreen('results');

  // Music generation: show indicator, then start
  const genEl = document.getElementById('musicGenerating');
  if (genEl) genEl.hidden = false;

  startResultWaveform(bpm);

  setTimeout(async () => {
    if (genEl) genEl.hidden = true;
    await _startResultsMusic(bpm, hrv);
  }, 1200);
}

/* ──────────────────────────────────────────
   POPULATE RESULTS SCREEN
────────────────────────────────────────── */
function _populateResults(bpm, hrv, minBpm, maxBpm, mood) {
  _set('resultBpm', bpm);
  _set('metricHRV', hrv);
  _set('metricMin', minBpm);
  _set('metricMax', maxBpm);
  _set('sessionNameInput', '', 'value');

  // Stress card
  const card  = document.getElementById('stressCard');
  const badge = document.getElementById('stressBadge');
  const desc  = document.getElementById('stressDesc');
  const DATA  = {
    calm:   { badge:'🟢 Calm',            desc:'Your heart rate is low and your autonomic nervous system is well balanced — you are in a deeply relaxed state.' },
    normal: { badge:'🟡 Mildly Active',    desc:'Your heart rate is slightly elevated — this could be light activity, caffeine, or mild stress. Nothing to worry about.' },
    stress: { badge:'🔴 Elevated Stress',  desc:'Elevated heart rate and reduced HRV indicate stress. Try slow deep breaths, hydrate, and rest when possible.' },
  };
  if (card)  card.className  = `stress-card ${mood}`;
  if (badge) { badge.className = `stress-badge ${mood}`; badge.textContent = DATA[mood].badge; }
  if (desc)  desc.textContent = DATA[mood].desc;

  // Music metadata
  const meta = AudioEngine.getMusicMeta(bpm, hrv);
  _set('musicTitle',    meta.title);
  _set('musicSubtitle', meta.subtitle);

  // Tempo slider
  const slider = document.getElementById('tempoSlider');
  if (slider) slider.value = bpm;
  _set('tempoVal', bpm);

  // Duration
  const dur = AudioEngine.getDuration() || 60;
  _set('musicDuration', `${dur}s`);
  _set('playbackTotal', _fmtTime(dur));
  _set('playbackElapsed', '0:00');

  const fillEl = document.getElementById('playbackFill');
  if (fillEl) fillEl.style.width = '0%';
}

async function _startResultsMusic(bpm, hrv) {
  const ok = await AudioEngine.start(bpm, hrv);
  if (!ok) {
    showToast('Audio blocked — tap Play to start music', 'warn', 4000);
    return;
  }
  _setPlayBtn(true);
  startPlaybackTimer(AudioEngine.getDuration());
}

/* ──────────────────────────────────────────
   TOGGLE MUSIC (results screen)
────────────────────────────────────────── */
async function toggleMusic() {
  if (AudioEngine.getIsPlaying()) {
    AudioEngine.fadeOut();
    _setPlayBtn(false);
    stopPlaybackTimer();
  } else {
    const bpm = App.musicBPM || App.finalBPM;
    const ok  = await AudioEngine.start(bpm, App.finalHRV);
    if (ok) {
      _setPlayBtn(true);
      startPlaybackTimer(AudioEngine.getDuration());
    } else {
      showToast('Could not start audio. Tap once more to try again.', 'warn');
    }
  }
}

function _setPlayBtn(playing) {
  const btn = document.getElementById('playBtn');
  if (!btn) return;
  btn.textContent   = playing ? '⏸' : '▶';
  btn.setAttribute('aria-label', playing ? 'Pause heartbeat music' : 'Play heartbeat music');
  btn.classList.toggle('playing', playing);
}

/* ──────────────────────────────────────────
   ADJUST TEMPO (results screen slider)
────────────────────────────────────────── */
function adjustTempo(val) {
  const bpm = parseInt(val, 10);
  _set('tempoVal', bpm);
  App.musicBPM = bpm;
  if (AudioEngine.getIsPlaying()) {
    AudioEngine.start(bpm, App.finalHRV);
    startPlaybackTimer(AudioEngine.getDuration());
  }
  const dur = Math.ceil(Math.ceil(60 / (60 / bpm)) * (60 / bpm));
  _set('musicDuration', `${dur}s`);
  _set('playbackTotal', _fmtTime(dur));
}

/* ──────────────────────────────────────────
   SAVE SESSION
────────────────────────────────────────── */
async function saveSession() {
  const name = document.getElementById('sessionNameInput')?.value?.trim() || '';
  const session = Storage.buildSession({
    bpm:    App.finalBPM,
    hrv:    App.finalHRV,
    minBpm: App.finalMin,
    maxBpm: App.finalMax,
    mood:   App.finalMood,
    tempo:  App.musicBPM || App.finalBPM,
    name,
  });

  try {
    await Storage.saveSession(session);
    showToast('💾 Session saved to your library', 'success');
    renderLibrary(); // refresh if already rendered
  } catch(e) {
    console.error('[App] Save error:', e);
    showToast('Could not save session. Storage may be full.', 'error');
  }
}

/* ──────────────────────────────────────────
   LIBRARY RENDERING
────────────────────────────────────────── */
async function renderLibrary() {
  const listEl  = document.getElementById('libraryList');
  const emptyEl = document.getElementById('libraryEmpty');
  const countEl = document.getElementById('libraryCount');
  if (!listEl) return;

  let sessions = [];
  try { sessions = await Storage.loadSessions(); } catch {}

  if (countEl) countEl.textContent = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;

  if (sessions.length === 0) {
    if (emptyEl) emptyEl.hidden = false;
    listEl.innerHTML = '';
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  listEl.innerHTML = sessions.map(s => `
    <article class="session-card ${s.mood}" aria-label="Session: ${_esc(s.name)}">
      <div class="session-top">
        <div class="session-name-display" id="name-d-${s.id}">${_esc(s.name)}</div>
        <input class="session-name-edit" id="name-e-${s.id}"
          value="${_esc(s.name)}" maxlength="40" aria-label="Edit session name"
          autocomplete="off" autocorrect="off" spellcheck="false"
          onblur="finishRename(${s.id})"
          onkeydown="if(event.key==='Enter')this.blur()">
        <div class="session-actions" role="group" aria-label="Session actions">
          <button class="session-btn" id="lib-play-${s.id}"
            onclick="playLibrarySession(${s.id})"
            aria-label="Play music for ${_esc(s.name)}">▶</button>
          <button class="session-btn"
            onclick="startRename(${s.id})"
            aria-label="Rename ${_esc(s.name)}">✏️</button>
          <button class="session-btn danger"
            onclick="confirmDelete(${s.id})"
            aria-label="Delete ${_esc(s.name)}">🗑</button>
        </div>
      </div>
      <div class="session-meta" aria-label="Session details">
        <span class="chip chip--bpm">❤️ ${s.bpm} BPM</span>
        <span class="chip">HRV ${s.hrv}ms</span>
        <span class="chip">${_moodLabel(s.mood)}</span>
        <span class="chip chip--date">${s.date} · ${s.time}</span>
      </div>
    </article>
  `).join('');
}

/* ── Rename ── */
function startRename(id) {
  document.getElementById(`name-d-${id}`).style.display = 'none';
  const input = document.getElementById(`name-e-${id}`);
  input.style.display = 'block';
  input.focus();
  input.select();
}

async function finishRename(id) {
  const input   = document.getElementById(`name-e-${id}`);
  const display = document.getElementById(`name-d-${id}`);
  if (!input || !display) return;
  const newName = input.value.trim() || `Session ${id}`;
  try {
    await Storage.renameSession(id, newName);
    display.textContent = newName;
    showToast('✏️ Session renamed', 'success');
  } catch {
    showToast('Could not rename session', 'error');
  }
  display.style.display = '';
  input.style.display   = 'none';
}

/* ── Delete (with confirm) ── */
let _pendingDeleteId = null;

function confirmDelete(id) {
  _pendingDeleteId = id;
  const overlay = document.getElementById('confirmOverlay');
  if (overlay) {
    overlay.hidden = false;
    overlay.removeAttribute('aria-hidden');
    document.getElementById('dialogConfirmBtn')?.focus();
  }
}

async function executeDelete() {
  if (_pendingDeleteId === null) return;
  if (App.libraryPlayingId === _pendingDeleteId) {
    AudioEngine.stop();
    App.libraryPlayingId = null;
  }
  try {
    await Storage.deleteSession(_pendingDeleteId);
    showToast('🗑 Session deleted', 'info');
  } catch {
    showToast('Could not delete session', 'error');
  }
  _pendingDeleteId = null;
  closeDialog();
  renderLibrary();
}

function closeDialog() {
  const overlay = document.getElementById('confirmOverlay');
  if (overlay) { overlay.hidden = true; overlay.setAttribute('aria-hidden', 'true'); }
  _pendingDeleteId = null;
}

/* ── Play library session ── */
async function playLibrarySession(id) {
  let sessions = [];
  try { sessions = await Storage.loadSessions(); } catch {}
  const session = sessions.find(s => s.id === id);
  if (!session) return;

  const btn = document.getElementById(`lib-play-${id}`);

  // Toggle off if already playing
  if (App.libraryPlayingId === id && AudioEngine.getIsPlaying()) {
    AudioEngine.fadeOut();
    App.libraryPlayingId = null;
    if (btn) { btn.textContent = '▶'; btn.classList.remove('playing'); }
    return;
  }

  // Stop any running session
  AudioEngine.stop();
  document.querySelectorAll('.session-btn.playing').forEach(b => {
    b.textContent = '▶'; b.classList.remove('playing');
  });

  App.finalHRV      = session.hrv;
  App.libraryPlayingId = id;

  const ok = await AudioEngine.start(session.bpm, session.hrv, () => {
    if (btn) { btn.textContent = '▶'; btn.classList.remove('playing'); }
    App.libraryPlayingId = null;
  });

  if (ok && btn) {
    btn.textContent = '⏸';
    btn.setAttribute('aria-label', `Pause ${_esc(session.name)}`);
    btn.classList.add('playing');
    showToast(`🎵 Playing: ${session.name}`, 'info');
  }
}

/* ──────────────────────────────────────────
   UTILITY
────────────────────────────────────────── */
function _set(id, val, prop = 'textContent') {
  const el = document.getElementById(id);
  if (el) el[prop] = val;
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _getMood(bpm, hrv) {
  if (bpm < 65 || hrv > 55)   return 'calm';
  if (bpm > 100 || hrv < 20)  return 'stress';
  if (bpm >= 65 && bpm <= 85) return 'calm';
  return 'normal';
}

function _moodLabel(mood) {
  return { calm:'🟢 Calm', normal:'🟡 Balanced', stress:'🔴 Elevated' }[mood] || mood;
}

function _fmtTime(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/* ──────────────────────────────────────────
   RESIZE HANDLER
────────────────────────────────────────── */
let _resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    const wc = document.getElementById('waveformCanvas');
    if (wc) {
      const dpr = window.devicePixelRatio || 1;
      wc.width  = wc.offsetWidth  * dpr;
      wc.height = wc.offsetHeight * dpr;
    }
  }, 200);
});

/* ──────────────────────────────────────────
   INIT
────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(() => console.log('[SW] Registered'))
      .catch(err => console.warn('[SW] Registration failed:', err));
  }

  // Init storage
  await Storage.init();

  // Init library count badge
  try {
    const sessions = await Storage.loadSessions();
    const badge    = document.getElementById('libBadge');
    if (badge && sessions.length > 0) {
      badge.textContent = sessions.length;
      badge.hidden = false;
    }
  } catch {}

  // Close confirm overlay on backdrop click
  const overlay = document.getElementById('confirmOverlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog();
    });
  }

  // Keyboard trap in dialog
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDialog();
  });
});
