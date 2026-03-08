/* ==========================================================
   HeartBeat Studio — audioEngine.js
   Web Audio API music engine.
   Generates heartbeat-driven music for minimum 60 seconds.
   Designed for iOS Safari compatibility.
========================================================== */

const AudioEngine = (() => {

  /* ── Musical scales mapped to mood ── */
  const SCALES = {
    calm:   [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25], // C major
    normal: [293.66, 329.63, 369.99, 392.00, 440.00, 493.88, 523.25, 587.33], // D major
    stress: [220.00, 246.94, 261.63, 293.66, 329.63, 369.99, 415.30, 440.00], // A minor
  };

  const MUSIC_KEYS   = ['C', 'D', 'E♭', 'F', 'G', 'A', 'B♭'];
  const MUSIC_STYLES = ['Serenade', 'Nocturne', 'Elegy', 'Reverie', 'Sonata', 'Prelude', 'Étude'];

  let audioCtx      = null;
  let masterGain    = null;
  let delayNode     = null;
  let feedbackGain  = null;
  let wetGain       = null;
  let lfoOsc        = null;
  let lfoGain       = null;
  let schedulerTimer = null;
  let isPlaying     = false;
  let nextBeatTime  = 0;
  let globalBeat    = 0;
  let currentBPM    = 72;
  let currentHRV    = 45;
  let totalBeats    = 72;    // beats for >= 60s
  let musicDuration = 60;
  let onStopCallback = null;

  /* ── Get or create AudioContext (iOS-safe) ── */
  function _getCtx() {
    if (!audioCtx || audioCtx.state === 'closed') {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) throw new Error('Web Audio API not supported');
      audioCtx = new Ctor();
    }
    return audioCtx;
  }

  /* ── Resume AudioContext (required after user gesture on iOS) ── */
  async function resume() {
    const ctx = _getCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx;
  }

  /* ── Schedule a single beat ── */
  function _scheduleBeat(ctx, scale, beatIdx, when, beatInterval, noteRange) {
    // Bass — root note, every beat
    const bassOsc  = ctx.createOscillator();
    const bassGain = ctx.createGain();
    bassOsc.type = 'sine';
    bassOsc.frequency.setValueAtTime(scale[0] / 2, when);
    bassGain.gain.setValueAtTime(0, when);
    bassGain.gain.linearRampToValueAtTime(0.45, when + 0.012);
    bassGain.gain.exponentialRampToValueAtTime(0.001, when + beatInterval * 0.88);
    bassOsc.connect(bassGain);
    bassGain.connect(masterGain);
    bassOsc.start(when);
    bassOsc.stop(when + beatInterval);

    // Melody — HRV-driven note selection
    const noteIdx    = Math.abs((beatIdx * 2 + Math.round(Math.sin(beatIdx * 0.7) * (noteRange - 1)))) % scale.length;
    const freq       = scale[noteIdx];
    const melOsc     = ctx.createOscillator();
    const melGain    = ctx.createGain();
    melOsc.type = beatIdx % 4 === 0 ? 'triangle' : 'sine';
    melOsc.frequency.setValueAtTime(freq, when);
    melGain.gain.setValueAtTime(0, when);
    melGain.gain.linearRampToValueAtTime(0.30, when + 0.05);
    melGain.gain.exponentialRampToValueAtTime(0.001, when + beatInterval * 0.75);
    if (lfoGain) lfoGain.connect(melGain.gain);
    melOsc.connect(melGain);
    melGain.connect(masterGain);
    if (delayNode) melGain.connect(delayNode);
    melOsc.start(when);
    melOsc.stop(when + beatInterval);

    // Harmony — perfect 5th every 2 beats
    if (beatIdx % 2 === 0) {
      const harmOsc  = ctx.createOscillator();
      const harmGain = ctx.createGain();
      harmOsc.type = 'sine';
      harmOsc.frequency.setValueAtTime(freq * 1.498, when);
      harmGain.gain.setValueAtTime(0, when);
      harmGain.gain.linearRampToValueAtTime(0.09, when + 0.08);
      harmGain.gain.exponentialRampToValueAtTime(0.001, when + beatInterval * 0.6);
      harmOsc.connect(harmGain);
      harmGain.connect(masterGain);
      harmOsc.start(when);
      harmOsc.stop(when + beatInterval);
    }

    // Soft percussion click
    try {
      const bufLen   = Math.ceil(ctx.sampleRate * 0.04);
      const clickBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const cd       = clickBuf.getChannelData(0);
      for (let i = 0; i < cd.length; i++) {
        cd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.004));
      }
      const click     = ctx.createBufferSource();
      const clickGain = ctx.createGain();
      click.buffer = clickBuf;
      clickGain.gain.setValueAtTime(beatIdx % 4 === 0 ? 0.07 : 0.025, when);
      click.connect(clickGain);
      clickGain.connect(masterGain);
      click.start(when);
    } catch(e) { /* skip click on failure */ }
  }

  /* ── Lookahead scheduler ── */
  function _runScheduler(ctx, scale, beatInterval, noteRange) {
    const LOOKAHEAD = 0.25; // seconds ahead to schedule
    while (nextBeatTime < ctx.currentTime + LOOKAHEAD) {
      const beatIdx = globalBeat % totalBeats;
      _scheduleBeat(ctx, scale, beatIdx, nextBeatTime, beatInterval, noteRange);
      nextBeatTime += beatInterval;
      globalBeat++;
    }
    schedulerTimer = setTimeout(() => _runScheduler(ctx, scale, beatInterval, noteRange), 100);
  }

  /* ── START MUSIC ── */
  async function start(bpm, hrv, onStop) {
    stop(); // clean up any existing

    let ctx;
    try {
      ctx = await resume();
    } catch(e) {
      console.error('[AudioEngine] AudioContext failed:', e);
      return false;
    }

    currentBPM    = Math.max(40, Math.min(200, bpm));
    currentHRV    = hrv || 45;
    onStopCallback = onStop || null;

    const beatInterval = 60 / currentBPM;
    const mood         = _getMood(currentBPM, currentHRV);
    const scale        = SCALES[mood];
    const noteRange    = Math.max(3, Math.min(8, Math.round(currentHRV / 10)));

    // Minimum 60 seconds
    totalBeats    = Math.ceil(60 / beatInterval);
    musicDuration = Math.ceil(totalBeats * beatInterval);

    // Master gain with fade-in
    masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.4);
    masterGain.connect(ctx.destination);

    // Echo / delay
    delayNode    = ctx.createDelay(1.0);
    feedbackGain = ctx.createGain();
    wetGain      = ctx.createGain();
    delayNode.delayTime.setValueAtTime(beatInterval * 0.5, ctx.currentTime);
    feedbackGain.gain.setValueAtTime(0.20, ctx.currentTime);
    wetGain.gain.setValueAtTime(0.12, ctx.currentTime);
    delayNode.connect(feedbackGain);
    feedbackGain.connect(delayNode);
    delayNode.connect(wetGain);
    wetGain.connect(masterGain);

    // LFO tremolo (breathing feel)
    lfoOsc  = ctx.createOscillator();
    lfoGain = ctx.createGain();
    lfoOsc.frequency.setValueAtTime(currentBPM / 120, ctx.currentTime);
    lfoGain.gain.setValueAtTime(0.025, ctx.currentTime);
    lfoOsc.connect(lfoGain);
    lfoOsc.start();

    globalBeat   = 0;
    nextBeatTime = ctx.currentTime + 0.1;
    isPlaying    = true;

    _runScheduler(ctx, scale, beatInterval, noteRange);
    return true;
  }

  /* ── STOP MUSIC ── */
  function stop() {
    if (schedulerTimer) { clearTimeout(schedulerTimer); schedulerTimer = null; }

    const nodes = [masterGain, delayNode, feedbackGain, wetGain, lfoOsc, lfoGain];
    nodes.forEach(n => {
      if (!n) return;
      try { n.stop && n.stop(); } catch(e) {}
      try { n.disconnect(); } catch(e) {}
    });

    masterGain = delayNode = feedbackGain = wetGain = lfoOsc = lfoGain = null;
    isPlaying  = false;

    if (onStopCallback) { onStopCallback(); onStopCallback = null; }
  }

  /* ── FADE OUT then STOP ── */
  function fadeOut(duration = 0.6) {
    if (!masterGain || !audioCtx) { stop(); return; }
    const ctx = audioCtx;
    masterGain.gain.setValueAtTime(masterGain.gain.value, ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
    setTimeout(stop, (duration + 0.1) * 1000);
  }

  /* ── GET metadata for display ── */
  function getMusicMeta(bpm, hrv) {
    const key   = MUSIC_KEYS[bpm % MUSIC_KEYS.length];
    const style = MUSIC_STYLES[Math.floor(bpm / 10) % MUSIC_STYLES.length];
    const mood  = _getMood(bpm, hrv);
    const moodLabels = { calm:'Ambient · Calm', normal:'Melodic · Balanced', stress:'Rhythmic · Intense' };
    return { title: `Pulse ${style} in ${key}`, subtitle: `${bpm} BPM · ${moodLabels[mood]}`, mood };
  }

  function getDuration() { return musicDuration; }
  function getIsPlaying() { return isPlaying; }

  /* ── Private helpers ── */
  function _getMood(bpm, hrv) {
    if (bpm < 65 || hrv > 55) return 'calm';
    if (bpm > 100 || hrv < 20) return 'stress';
    if (bpm >= 65 && bpm <= 85) return 'calm';
    return 'normal';
  }

  return { start, stop, fadeOut, resume, getMusicMeta, getDuration, getIsPlaying };
})();

if (typeof module !== 'undefined') module.exports = AudioEngine;
else window.AudioEngine = AudioEngine;
