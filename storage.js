/* ==========================================================
   HeartBeat Studio — storage.js
   IndexedDB storage with localStorage fallback.
   All data stays on-device. Zero server dependency.
========================================================== */

const Storage = (() => {
  const DB_NAME    = 'heartbeat_studio_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'sessions';
  const LS_KEY     = 'heartbeat_sessions_v2';

  let db = null;
  let useIndexedDB = false;

  /* ── INIT ── open or create the database ── */
  async function init() {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        console.warn('[Storage] IndexedDB unavailable, using localStorage');
        resolve(false);
        return;
      }

      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
        }
      };

      req.onsuccess = (e) => {
        db = e.target.result;
        useIndexedDB = true;
        resolve(true);
      };

      req.onerror = () => {
        console.warn('[Storage] IndexedDB error, falling back to localStorage');
        resolve(false);
      };
    });
  }

  /* ── SAVE SESSION ── */
  async function saveSession(session) {
    if (useIndexedDB && db) {
      return new Promise((resolve, reject) => {
        const tx    = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req   = store.put(session);
        req.onsuccess = () => resolve(session);
        req.onerror   = (e) => reject(e.target.error);
      });
    } else {
      // localStorage fallback
      const sessions = _lsLoad();
      const idx      = sessions.findIndex(s => s.id === session.id);
      if (idx >= 0) sessions[idx] = session;
      else sessions.unshift(session);
      _lsSave(sessions);
      return session;
    }
  }

  /* ── LOAD ALL SESSIONS ── newest first ── */
  async function loadSessions() {
    if (useIndexedDB && db) {
      return new Promise((resolve, reject) => {
        const tx      = db.transaction(STORE_NAME, 'readonly');
        const store   = tx.objectStore(STORE_NAME);
        const req     = store.getAll();
        req.onsuccess = (e) => {
          const results = (e.target.result || [])
            .sort((a, b) => b.id - a.id); // newest first
          resolve(results);
        };
        req.onerror = (e) => reject(e.target.error);
      });
    } else {
      return _lsLoad();
    }
  }

  /* ── DELETE SESSION ── */
  async function deleteSession(id) {
    if (useIndexedDB && db) {
      return new Promise((resolve, reject) => {
        const tx    = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req   = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror   = (e) => reject(e.target.error);
      });
    } else {
      const sessions = _lsLoad().filter(s => s.id !== id);
      _lsSave(sessions);
      return true;
    }
  }

  /* ── RENAME SESSION ── */
  async function renameSession(id, newName) {
    if (useIndexedDB && db) {
      return new Promise((resolve, reject) => {
        const tx    = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get(id);
        getReq.onsuccess = (e) => {
          const session = e.target.result;
          if (!session) { reject(new Error('Session not found')); return; }
          session.name = newName;
          const putReq = store.put(session);
          putReq.onsuccess = () => resolve(session);
          putReq.onerror   = (e2) => reject(e2.target.error);
        };
        getReq.onerror = (e) => reject(e.target.error);
      });
    } else {
      const sessions = _lsLoad();
      const idx      = sessions.findIndex(s => s.id === id);
      if (idx >= 0) {
        sessions[idx].name = newName;
        _lsSave(sessions);
        return sessions[idx];
      }
      throw new Error('Session not found');
    }
  }

  /* ── Private: localStorage helpers ── */
  function _lsLoad() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    } catch { return []; }
  }
  function _lsSave(sessions) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(sessions));
    } catch (e) {
      console.error('[Storage] localStorage write failed:', e);
    }
  }

  /* ── BUILD SESSION OBJECT ── */
  function buildSession({ bpm, hrv, minBpm, maxBpm, mood, tempo, name }) {
    const now  = new Date();
    const id   = now.getTime();
    const date = now.toISOString().split('T')[0];
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const finalName = (name || '').trim() ||
      `Session · ${now.toLocaleDateString([], { month:'short', day:'numeric' })} ${time}`;

    return { id, name: finalName, bpm, hrv, minBpm, maxBpm, mood, tempo, date, time };
  }

  return { init, saveSession, loadSessions, deleteSession, renameSession, buildSession };
})();

/* Export for module environments, or attach to window */
if (typeof module !== 'undefined') module.exports = Storage;
else window.Storage = Storage;
