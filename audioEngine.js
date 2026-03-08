/* ================================================================
   HeartBeat Studio — audioEngine.js v4
   GENERATIVE BIOMETRIC MUSIC ENGINE

   Every session sounds uniquely different because the entire
   composition is derived from the person's biometric fingerprint:

     BPM  →  tempo, pulse subdivision, bass heartbeat interval
     HRV  →  rhythmic swing amount, note gate length, melodic range,
              syncopation probability, harmonic density
     Mood →  scale / mode, timbre palette, effect character,
              percussion texture, reverb space size

   ─── MOOD PROFILES ─────────────────────────────────────────────
   CALM      bpm < 65  OR  hrv > 55
     Scale   : Eb Major pentatonic — open, warm, floating
     Timbre  : pure sine pads + triangle melody, no percussion
     Space   : long hall reverb, deep echo, very slow LFO breath
     Feel    : weightless, meditative, like breathing underwater

   BALANCED  bpm 65–100  AND  hrv 20–55
     Scale   : D Dorian — warm modal, hopeful, grounded
     Timbre  : triangle melody, plucked triangle bass, soft shaker
     Space   : room reverb, dotted-quarter delay, gentle swing
     Feel    : walking pace, clear-headed, melodic focus

   STRESSED  bpm > 100  OR  hrv < 20
     Scale   : B Phrygian dominant — tense, driving, forward
     Timbre  : sawtooth melody + bass, hard kick+snare, tight hat
     Space   : tight plate reverb, short delay, minimal swing
     Feel    : urgent, kinetic, heartbeat driving everything
   ─────────────────────────────────────────────────────────────
================================================================ */
'use strict';

const AudioEngine = (() => {

  /* ════════════════════════════════════════════════════════════
     BIOMETRIC PROFILES
     Each profile is a completely independent sonic world.
     The 8-step grid patterns are the rhythmic DNA of each mood.
  ════════════════════════════════════════════════════════════ */
  const PROFILES = {

    calm: {
      /* Eb Major pentatonic (Eb F G Bb C) across two octaves */
      scale:   [155.56, 174.61, 196.00, 233.08, 261.63,
                311.13, 349.23, 392.00, 466.16, 523.25],
      bassOct: [77.78, 116.54],          /* root + fifth, -1 oct */
      modeName:'Eb Pentatonic',
      style:   'Ambient Float',
      moodLabel:'Deep Calm',

      /* Oscillator waveforms — sines are the softest */
      bassWave:'sine', melWave:'triangle', padWave:'sine', harmWave:'sine',

      /* Amplitude levels */
      bassAmp:0.28, padAmp:0.18, melAmp:0.20, harmAmp:0.09,
      /* Decay as fraction of one step-interval */
      bassDecF:0.96, padDecF:0.99, melDecF:0.86, harmDecF:0.92,
      /* Note attack time (seconds) */
      attackS:0.045,

      /* ── 8-step rhythmic grids (1 = play, 0 = rest) ──────── */
      bassGrid: [1,0,0,0, 1,0,0,0],   /* half-time, very sparse  */
      melGrid:  [1,0,1,0, 0,1,0,0],   /* sparse pentatonic drift  */
      harmGrid: [0,0,1,0, 0,0,1,0],   /* wide offbeat harmonics   */
      padGrid:  [1,0,0,0, 0,0,0,0],   /* one long chord per bar   */
      padDurMul:7.6,                   /* pad holds this many steps */

      /* No percussion in calm */
      kick:false, snare:false, hihat:false,

      /* Delay effect — dotted-half note feel */
      delayRatio:0.75, delayFB:0.44, delayWet:0.32,
      /* Convolution reverb size & wet level */
      reverbSec:4.2, reverbWet:0.42,
      /* Master output volume */
      masterVol:0.150,

      /* LFO — slow pad volume breathing */
      lfoHz:0.09, lfoDepth:0.032,

      /* HRV-driven swing: seconds = swingBase + hrv * swingHrvMul */
      swingBase:0.026, swingHrvMul:0.00055,
    },

    balanced: {
      /* D Dorian (D E F G A B C) — warm, modal */
      scale:   [146.83, 164.81, 174.61, 196.00, 220.00,
                246.94, 261.63, 293.66, 329.63, 349.23],
      bassOct: [73.42, 110.00],
      modeName:'D Dorian',
      style:   'Melodic Flow',
      moodLabel:'Balanced',

      bassWave:'triangle', melWave:'triangle', padWave:'sine', harmWave:'sine',

      bassAmp:0.34, padAmp:0.09, melAmp:0.23, harmAmp:0.11,
      bassDecF:0.66, padDecF:0.88, melDecF:0.60, harmDecF:0.70,
      attackS:0.016,

      bassGrid: [1,0,0,1, 0,0,1,0],
      melGrid:  [1,0,1,1, 0,1,0,1],
      harmGrid: [0,1,0,0, 1,0,0,1],
      padGrid:  [1,0,0,0, 1,0,0,0],
      padDurMul:3.8,

      kick:true,  kickGrid: [1,0,0,0, 1,0,0,0],
      snare:true, snareGrid:[0,0,1,0, 0,0,1,0],
      hihat:true, hihatGrid:[1,1,0,1, 1,1,0,1],

      delayRatio:0.50, delayFB:0.22, delayWet:0.16,
      reverbSec:1.7, reverbWet:0.18,
      masterVol:0.162,

      lfoHz:0.26, lfoDepth:0.018,
      swingBase:0.012, swingHrvMul:0.00025,
    },

    stressed: {
      /* B Phrygian dominant (B C D# E F# G A) */
      scale:   [246.94, 261.63, 311.13, 329.63, 369.99,
                392.00, 440.00, 493.88, 523.25, 587.33],
      bassOct: [123.47, 185.00],
      modeName:'B Phrygian',
      style:   'Kinetic Pulse',
      moodLabel:'Energised',

      bassWave:'sawtooth', melWave:'sawtooth', padWave:'square', harmWave:'square',

      bassAmp:0.22, padAmp:0.06, melAmp:0.19, harmAmp:0.13,
      bassDecF:0.40, padDecF:0.48, melDecF:0.36, harmDecF:0.44,
      attackS:0.006,

      bassGrid: [1,0,1,0, 1,1,0,1],
      melGrid:  [1,1,0,1, 1,0,1,1],
      harmGrid: [1,0,0,1, 0,1,0,0],
      padGrid:  [1,0,0,0, 0,0,0,0],
      padDurMul:1.8,

      kick:true,  kickGrid: [1,0,1,0, 1,0,1,0],
      snare:true, snareGrid:[0,0,1,0, 0,1,1,0],
      hihat:true, hihatGrid:[1,1,1,1, 1,1,1,1],

      delayRatio:0.25, delayFB:0.12, delayWet:0.08,
      reverbSec:0.65, reverbWet:0.08,
      masterVol:0.148,

      lfoHz:0.68, lfoDepth:0.010,
      swingBase:0.004, swingHrvMul:0.00010,
    },
  };

  /* ════════════════════════════════════════════════════════════
     DISPLAY METADATA POOLS
  ════════════════════════════════════════════════════════════ */
  const TITLE_WORDS = [
    'Meridian','Artery','Current','Threshold','Resonance',
    'Drift','Continuum','Orbit','Flux','Tide','Pulse','Reverie',
  ];
  const CHROMATIC = ['C','C♯','D','Eb','E','F','F♯','G','Ab','A','Bb','B'];

  /* ════════════════════════════════════════════════════════════
     ENGINE STATE
  ════════════════════════════════════════════════════════════ */
  let _ctx     = null;
  let _master  = null;
  let _lfoGain = null;
  let _delay   = null;
  let _reverb  = null;
  let _allNodes= [];
  let _sched   = null;
  let _playing = false;
  let _nextBar = 0;
  let _barN    = 0;
  let _dur     = 60;
  let _stopCb  = null;

  /* ════════════════════════════════════════════════════════════
     AUDIO CONTEXT (iOS Safari-safe lazy init)
  ════════════════════════════════════════════════════════════ */
  function _ctxGet() {
    if (!_ctx || _ctx.state === 'closed') {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('Web Audio API not supported');
      _ctx = new AC();
    }
    return _ctx;
  }

  async function resume() {
    const c = _ctxGet();
    if (c.state === 'suspended') await c.resume();
    return c;
  }

  /* ════════════════════════════════════════════════════════════
     NODE FACTORY — tracks every node so teardown is complete
  ════════════════════════════════════════════════════════════ */
  function _tr(...ns) { _allNodes.push(...ns); return ns[ns.length - 1]; }

  /* ════════════════════════════════════════════════════════════
     SYNTHESISED CONVOLUTION REVERB
     Procedurally generates an impulse response that sounds like
     the target acoustic space. Much richer than a simple delay.
  ════════════════════════════════════════════════════════════ */
  function _makeReverb(c, sizeS) {
    const sr  = c.sampleRate;
    const len = Math.ceil(sr * Math.max(0.4, sizeS));
    const ir  = c.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        /* Pre-delay gap (first 8ms quiet), then exponential decay noise */
        const preDelay = i < Math.floor(sr * 0.008) ? 0.05 : 1.0;
        d[i] = (Math.random() * 2 - 1) * preDelay * Math.pow(1 - i / len, 2.1);
      }
    }
    const conv = c.createConvolver();
    conv.buffer = ir;
    return _tr(conv);
  }

  /* ════════════════════════════════════════════════════════════
     WHITE NOISE BUFFER  (reused for all percussive transients)
  ════════════════════════════════════════════════════════════ */
  function _noiseBuf(c, ms) {
    const len = Math.ceil(c.sampleRate * ms / 1000);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* ════════════════════════════════════════════════════════════
     SCHEDULE A TONAL NOTE
     Returns the gain (envelope) node so callers can attach LFO.
  ════════════════════════════════════════════════════════════ */
  function _note(c, t, freq, wave, amp, attackS, decayFrac, interval, dest) {
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp, t + attackS);
    env.gain.exponentialRampToValueAtTime(0.0001,
      t + Math.max(attackS + 0.01, interval * decayFrac));
    osc.connect(env);
    env.connect(dest);
    osc.start(t);
    osc.stop(t + interval + 0.05);
    _tr(osc, env);
    return env;
  }

  /* ════════════════════════════════════════════════════════════
     KICK DRUM — pitched sine sweep, voiced per mood
  ════════════════════════════════════════════════════════════ */
  function _kick(c, t, stressed) {
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(stressed ? 190 : 105, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.14);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(stressed ? 0.62 : 0.45, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + (stressed ? 0.18 : 0.25));
    osc.connect(env); env.connect(_master);
    osc.start(t); osc.stop(t + 0.30);
    _tr(osc, env);
  }

  /* ════════════════════════════════════════════════════════════
     SNARE — bandpass noise burst, mood-voiced
  ════════════════════════════════════════════════════════════ */
  function _snare(c, t, stressed) {
    const src = c.createBufferSource();
    const flt = c.createBiquadFilter();
    const env = c.createGain();
    src.buffer = _noiseBuf(c, 200);
    flt.type = 'bandpass';
    flt.frequency.value = stressed ? 2700 : 1700;
    flt.Q.value = 0.9;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(stressed ? 0.36 : 0.21, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + (stressed ? 0.13 : 0.17));
    src.connect(flt); flt.connect(env); env.connect(_master);
    src.start(t); src.stop(t + 0.22);
    _tr(src, flt, env);
  }

  /* ════════════════════════════════════════════════════════════
     HI-HAT — high-pass noise, open/closed variant
  ════════════════════════════════════════════════════════════ */
  function _hihat(c, t, open, stressed) {
    const ms  = open ? 115 : 32;
    const src = c.createBufferSource();
    const flt = c.createBiquadFilter();
    const env = c.createGain();
    src.buffer = _noiseBuf(c, ms);
    flt.type = 'highpass';
    flt.frequency.value = stressed ? 9800 : 7200;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(open ? 0.11 : 0.065, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    src.connect(flt); flt.connect(env); env.connect(_master);
    src.start(t); src.stop(t + ms / 1000 + 0.01);
    _tr(src, flt, env);
  }

  /* ════════════════════════════════════════════════════════════
     BIOLOGICAL HEARTBEAT PULSE — LUB · DUB transients
     Always present, underlying the music at the person's BPM.
     LUB on beat 1 of every bar; DUB ~28% of bar duration later.
     Voiced with resonant low-pass noise for biological realism.
  ════════════════════════════════════════════════════════════ */
  function _heartbeat(c, t, barDur, mood) {
    const stressed = mood === 'stressed';
    const calm     = mood === 'calm';

    /* LUB — louder, lower resonance */
    {
      const src = c.createBufferSource();
      const flt = c.createBiquadFilter();
      const env = c.createGain();
      src.buffer     = _noiseBuf(c, 70);
      flt.type       = 'lowpass';
      flt.frequency.value = stressed ? 270 : calm ? 140 : 200;
      flt.Q.value    = 5.0;
      const lubAmp   = stressed ? 0.30 : calm ? 0.11 : 0.18;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(lubAmp, t + 0.009);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.068);
      src.connect(flt); flt.connect(env); env.connect(_master);
      src.start(t); src.stop(t + 0.080);
      _tr(src, flt, env);
    }

    /* DUB — softer, slightly higher pitch, follows LUB */
    {
      const dt  = t + barDur * 0.28;
      const src = c.createBufferSource();
      const flt = c.createBiquadFilter();
      const env = c.createGain();
      src.buffer     = _noiseBuf(c, 50);
      flt.type       = 'lowpass';
      flt.frequency.value = stressed ? 360 : calm ? 200 : 270;
      flt.Q.value    = 4.0;
      const dubAmp   = stressed ? 0.18 : calm ? 0.066 : 0.11;
      env.gain.setValueAtTime(0, dt);
      env.gain.linearRampToValueAtTime(dubAmp, dt + 0.007);
      env.gain.exponentialRampToValueAtTime(0.0001, dt + 0.050);
      src.connect(flt); flt.connect(env); env.connect(_master);
      src.start(dt); src.stop(dt + 0.060);
      _tr(src, flt, env);
    }
  }

  /* ════════════════════════════════════════════════════════════
     MELODY NOTE PICKER
     HRV controls melodic spread:
       Low HRV  → narrow range, repetitive (rigid, tense)
       High HRV → wide range, wandering arcs (flowing, open)
     barN + stepN give an evolving but deterministic sequence.
  ════════════════════════════════════════════════════════════ */
  function _pickNote(scale, barN, stepN, hrv) {
    const spread  = Math.max(2, Math.min(scale.length - 1, Math.round(hrv / 8)));
    const contour = Math.sin(barN * 0.37 + stepN * 0.23) * (spread * 0.55);
    const walk    = Math.round(contour + barN * 0.14 + stepN * 0.10);
    return scale[Math.abs(walk) % scale.length];
  }

  /* ════════════════════════════════════════════════════════════
     HRV SWING TIMING
     High HRV → more human push-pull timing (jazz feel)
     Low HRV  → machine-tight timing (robotic urgency)
     Applied per step with alternating groove and micro-jitter.
  ════════════════════════════════════════════════════════════ */
  function _swing(stepIdx, hrv, p) {
    const base   = p.swingBase + hrv * p.swingHrvMul;
    const groove = stepIdx % 2 === 1 ? base : -base * 0.22;
    const jitter = (Math.random() - 0.5) * hrv * 0.00028;
    return groove + jitter;
  }

  /* ════════════════════════════════════════════════════════════
     SCHEDULE ONE FULL BAR
     One bar = one 8-step pattern cycle.
     barStart : AudioContext time of bar beat-1
     stepSec  : duration of one step = 60 / BPM
  ════════════════════════════════════════════════════════════ */
  function _schedBar(c, barStart, stepSec, hrv, bpm, mood) {
    const p        = PROFILES[mood];
    const stressed = mood === 'stressed';
    const nSteps   = p.melGrid.length; /* 8 */
    const barDur   = stepSec * nSteps;

    /* ── Biological heartbeat pulse on every bar-1 ── */
    _heartbeat(c, barStart, barDur, mood);

    for (let s = 0; s < nSteps; s++) {
      /* Apply HRV swing to step time (never before barStart) */
      const t = Math.max(barStart, barStart + s * stepSec + _swing(s, hrv, p));

      /* ── Bass ── */
      if (p.bassGrid[s]) {
        const bf = s < nSteps / 2 ? p.bassOct[0] : p.bassOct[1];
        _note(c, t, bf, p.bassWave,
          p.bassAmp, p.attackS, p.bassDecF, stepSec, _master);
      }

      /* ── Melody — routes through delay for echo texture ── */
      if (p.melGrid[s]) {
        const freq = _pickNote(p.scale, _barN, s, hrv);
        const melE = _note(c, t, freq, p.melWave,
          p.melAmp, p.attackS, p.melDecF, stepSec, _delay || _master);
        /* Attach LFO tremolo to melody envelope */
        if (_lfoGain) { try { _lfoGain.connect(melE.gain); } catch {} }
      }

      /* ── Harmony (5th or minor 3rd above melody) ── */
      if (p.harmGrid[s]) {
        const freq  = _pickNote(p.scale, _barN, s + 2, hrv);
        const ratio = s % 4 < 2 ? 1.4983 : 1.2599;  /* P5 or m3 */
        _note(c, t, freq * ratio, p.harmWave,
          p.harmAmp, p.attackS * 1.8, p.harmDecF, stepSec,
          _reverb || _master);
      }

      /* ── Sustained pad chord (only on pad-grid beats) ── */
      if (p.padGrid[s]) {
        const padDur = stepSec * p.padDurMul;
        [p.scale[0], p.scale[2], p.scale[4]].forEach((f, i) => {
          _note(c, t, f, p.padWave,
            p.padAmp * (1 - i * 0.18),
            p.attackS * 5,
            Math.min(0.999, padDur / Math.max(0.01, padDur + 0.001)),
            padDur,
            _reverb || _master);
        });
      }

      /* ── Percussion ── */
      if (p.kick  && p.kickGrid [s]) _kick (c, t, stressed);
      if (p.snare && p.snareGrid[s]) _snare(c, t, stressed);
      if (p.hihat && p.hihatGrid[s]) {
        /* Step 4 (beat 3 of bar) gets open hi-hat, rest closed */
        _hihat(c, t, s === 4, stressed);
      }
    }
  }

  /* ════════════════════════════════════════════════════════════
     LOOKAHEAD SCHEDULER
     Fires every 90ms, schedules bars ~320ms ahead.
     Separates audio precision from JS thread timing.
  ════════════════════════════════════════════════════════════ */
  function _scheduler(c, stepSec, hrv, bpm, mood) {
    const barDur = stepSec * PROFILES[mood].melGrid.length;
    const ahead  = 0.32;
    while (_nextBar < c.currentTime + ahead) {
      _schedBar(c, _nextBar, stepSec, hrv, bpm, mood);
      _nextBar += barDur;
      _barN++;
    }
    _sched = setTimeout(() => _scheduler(c, stepSec, hrv, bpm, mood), 90);
  }

  /* ════════════════════════════════════════════════════════════
     PUBLIC — START
     Tears down any existing session, then instantiates a fresh
     audio graph from the biometric inputs.
  ════════════════════════════════════════════════════════════ */
  async function start(bpm, hrv, onStopFn) {
    stop();

    let c;
    try { c = await resume(); }
    catch (e) { console.error('[AudioEngine]', e); return false; }

    const B    = Math.max(40, Math.min(200, bpm || 72));
    const H    = Math.max(10, Math.min(100, hrv || 45));
    const mood = _moodKey(B, H);
    const p    = PROFILES[mood];

    /* Beat interval = time between BPM pulses */
    const stepSec = 60 / B;
    const barDur  = stepSec * p.melGrid.length;   /* 8 steps = 1 bar */

    /* Guarantee ≥ 60 s of music (always full bars) */
    const barsNeeded = Math.ceil(60 / barDur);
    _dur     = Math.ceil(barsNeeded * barDur);
    _stopCb  = onStopFn || null;
    _allNodes = [];
    _barN    = 0;

    /* ── Master output bus with fade-in ── */
    _master = c.createGain();
    _master.gain.setValueAtTime(0, c.currentTime);
    _master.gain.linearRampToValueAtTime(p.masterVol, c.currentTime + 0.9);
    _master.connect(c.destination);

    /* ── Convolution reverb (wet signal only routed here) ── */
    const rvWet = c.createGain();
    rvWet.gain.value = p.reverbWet;
    _reverb = _makeReverb(c, p.reverbSec);
    _reverb.connect(rvWet);
    rvWet.connect(_master);
    _tr(rvWet);

    /* ── Melodic delay (feedback echo for melody depth) ── */
    const dly = c.createDelay(2.0);
    const dfb = c.createGain();
    const dwt = c.createGain();
    dly.delayTime.setValueAtTime(stepSec * p.delayRatio, c.currentTime);
    dfb.gain.setValueAtTime(p.delayFB, c.currentTime);
    dwt.gain.setValueAtTime(p.delayWet, c.currentTime);
    dly.connect(dfb); dfb.connect(dly);
    dly.connect(dwt); dwt.connect(_master);
    _delay = dly;
    _tr(dly, dfb, dwt);

    /* ── LFO — tremolo on sustained notes, speed = mood energy ── */
    const lfoOsc = c.createOscillator();
    const lfoGn  = c.createGain();
    lfoOsc.frequency.setValueAtTime(p.lfoHz, c.currentTime);
    lfoGn.gain.setValueAtTime(p.lfoDepth, c.currentTime);
    lfoOsc.connect(lfoGn);
    lfoOsc.start();
    _lfoGain = lfoGn;
    _tr(lfoOsc, lfoGn);

    /* ── Launch lookahead scheduler ── */
    _nextBar = c.currentTime + 0.12;
    _playing = true;
    _scheduler(c, stepSec, H, B, mood);

    return true;
  }

  /* ════════════════════════════════════════════════════════════
     PUBLIC — STOP
  ════════════════════════════════════════════════════════════ */
  function stop() {
    if (_sched) { clearTimeout(_sched); _sched = null; }
    _allNodes.forEach(n => {
      try { n.stop?.(); }    catch {}
      try { n.disconnect(); } catch {}
    });
    _allNodes = [];
    if (_master) { try { _master.disconnect(); } catch {}; _master = null; }
    _reverb = _delay = _lfoGain = null;
    _playing = false;
    if (_stopCb) { _stopCb(); _stopCb = null; }
  }

  /* ════════════════════════════════════════════════════════════
     PUBLIC — FADE OUT
  ════════════════════════════════════════════════════════════ */
  function fadeOut(sec = 1.4) {
    if (!_master || !_ctx) { stop(); return; }
    _master.gain.setValueAtTime(_master.gain.value, _ctx.currentTime);
    _master.gain.linearRampToValueAtTime(0.0001, _ctx.currentTime + sec);
    setTimeout(stop, (sec + 0.15) * 1000);
  }

  /* ════════════════════════════════════════════════════════════
     PUBLIC — getMeta
     Returns display strings seeded deterministically from BPM+HRV
     so the same biometric session always gets the same title.
     Identical surface to v3 — app.js needs zero changes.
  ════════════════════════════════════════════════════════════ */
  function getMeta(bpm, hrv) {
    const B    = Math.max(40, Math.min(200, bpm || 72));
    const H    = Math.max(10, Math.min(100, hrv  || 45));
    const mood = _moodKey(B, H);
    const p    = PROFILES[mood];

    const titleIdx = Math.abs(Math.round(B * 1.3 + H * 0.7)) % TITLE_WORDS.length;
    const keyNote  = CHROMATIC[Math.round(B / 5.5) % 12];
    const hrvLabel = H > 52 ? 'High Variability'
                   : H > 28 ? 'Moderate Variability'
                   :           'Low Variability';
    return {
      title:     `${TITLE_WORDS[titleIdx]} in ${keyNote}`,
      subtitle:  `${B} BPM · ${p.style} · ${hrvLabel}`,
      mood,
      moodLabel: p.moodLabel,
      scaleName: p.modeName,
    };
  }

  /* ════════════════════════════════════════════════════════════
     MOOD CLASSIFIER  — matches app.js _mood() exactly
  ════════════════════════════════════════════════════════════ */
  function _moodKey(bpm, hrv) {
    if (bpm > 100 || hrv < 20) return 'stressed';
    if (bpm < 65  || hrv > 55) return 'calm';
    return 'balanced';
  }

  /* ════════════════════════════════════════════════════════════
     EXPORTS  — identical API surface to v3; app.js unchanged
  ════════════════════════════════════════════════════════════ */
  return {
    start,
    stop,
    fadeOut,
    resume,
    getMeta,
    getDuration:  () => _dur,
    getIsPlaying: () => _playing,
  };

})();

window.AudioEngine = AudioEngine;
