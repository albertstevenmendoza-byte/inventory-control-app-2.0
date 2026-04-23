/**
 * novus-core.js — Novus Ops Shared Core (Supabase Edition)
 * Plant 1730 · Buena Park, CA
 *
 * Provides:
 *   window.sb              — Initialized Supabase client (use everywhere)
 *   window.SESSION_ID      — Today's session key e.g. 'S-2026-04-22'
 *   window.AISLE_ROWS      — Aisle letter array
 *   window.NovusSettings   — Theme + identity IIFE
 *   window.toast()         — Lightweight toast notification
 *   window.debounce()      — Input debounce utility
 *   window.haptic()        — Haptic feedback utility
 *   window.escHtml()       — XSS-safe HTML escaping
 *
 * REQUIRED: Load the Supabase CDN script BEFORE this file:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="novus-core.js"></script>
 *
 * safety.html and index.html do NOT load this file — intentional.
 */

'use strict';

/* ─────────────────────────────────────────────────────
   ★  CONFIGURATION — FILL THESE IN (Step 4 in GUIDE.md)
───────────────────────────────────────────────────── */

const SUPABASE_URL      = 'https://mnkxobbolxmhisqerkal.supabase.co'; // ← YOUR PROJECT URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ua3hvYmJvbHhtaGlzcWVya2FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5MDU5NTIsImV4cCI6MjA5MjQ4MTk1Mn0.fmdg2ludtpHTyiJJ2FGh8QpndSOO4mQdpkf3bJgHT2c';                           // ← YOUR ANON KEY

/* ─────────────────────────────────────────────────────
   SUPABASE CLIENT
   window.sb is the single shared client instance used
   by all page scripts for every database operation.
───────────────────────────────────────────────────── */

window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // No user auth — anon key + RLS handles access control
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
    // Keep realtime connection alive aggressively for monitor.html
    heartbeatIntervalMs: 15000,
  },
});

/* ─────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────── */

// Session ID: one counting session per calendar day.
// Format: 'S-YYYY-MM-DD' (e.g. 'S-2026-04-22')
window.SESSION_ID = 'S-' + new Date().toISOString().split('T')[0];

// Aisle letters used at Plant 1730 (no I or O — avoid barcode confusion)
window.AISLE_ROWS = 'ABCDEFGHJKLMNP'.split('');


/* ─────────────────────────────────────────────────────
   SETTINGS MODULE
   Handles theme, user identity, and app preferences.
   Persisted to localStorage; never requires a server
   round-trip — zero latency for these operations.
───────────────────────────────────────────────────── */

window.NovusSettings = (() => {
  const STORAGE_KEY = 'novus_settings';
  const DEFAULTS    = {
    userName: '', theme: 'dark',
    hapticFeedback: true, compactMode: false,
  };

  /* Color tokens for light and dark mode.
     Applied as CSS custom properties on :root. */
  const LIGHT_VARS = {
    '--bg':'#f8f9fb','--surface':'#ffffff','--surface-2':'#f1f3f5','--surface-3':'#e5e7eb',
    '--border':'#d1d5dc','--text':'#111827','--text-2':'#374151','--text-3':'#6b7280',
    '--accent':'#2563eb','--accent-dim':'rgba(37,99,235,.07)',
    '--green':'#059669','--green-bg':'rgba(5,150,105,.08)','--green-border':'rgba(5,150,105,.25)',
    '--red':'#dc2626','--red-bg':'rgba(220,38,38,.07)','--red-border':'rgba(220,38,38,.25)',
    '--amber':'#b45309','--amber-bg':'rgba(180,83,9,.07)','--amber-border':'rgba(180,83,9,.25)',
    '--purple':'#7c3aed','--purple-bg':'rgba(124,58,237,.07)',
    '--cyan':'#0e7490','--cyan-bg':'rgba(14,116,144,.07)',
  };

  const DARK_VARS = {
    '--bg':'#0f1117','--surface':'#181a23','--surface-2':'#1f2230','--surface-3':'#2a2d3a',
    '--border':'#313546','--text':'#eceef4','--text-2':'#9ba1b5','--text-3':'#6c7189',
    '--accent':'#5b9aff','--accent-dim':'rgba(91,154,255,.1)',
    '--green':'#34d399','--green-bg':'rgba(52,211,153,.1)','--green-border':'rgba(52,211,153,.25)',
    '--red':'#f87171','--red-bg':'rgba(248,113,113,.1)','--red-border':'rgba(248,113,113,.25)',
    '--amber':'#fbbf24','--amber-bg':'rgba(251,191,36,.1)','--amber-border':'rgba(251,191,36,.25)',
    '--purple':'#a78bfa','--purple-bg':'rgba(167,139,250,.1)',
    '--cyan':'#22d3ee','--cyan-bg':'rgba(34,211,238,.1)',
  };

  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch { return { ...DEFAULTS }; }
  }

  function saveAll(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
  }

  let _cache = loadAll();

  // Migrate legacy name key if present
  const legacyName = localStorage.getItem('novus_name');
  if (legacyName && !_cache.userName) {
    _cache.userName = legacyName;
    saveAll(_cache);
  }

  function get(key)     { return _cache[key] !== undefined ? _cache[key] : DEFAULTS[key]; }
  function getUser()    { return get('userName') || ''; }

  function set(key, val) {
    _cache[key] = val;
    saveAll(_cache);
    if (key === 'userName') localStorage.setItem('novus_name', val);
    if (key === 'theme')    applyTheme();
  }

  function applyTheme() {
    const vars = get('theme') === 'light' ? LIGHT_VARS : DARK_VARS;
    const root = document.documentElement;
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
    document.body.setAttribute('data-theme', get('theme'));
  }

  /* ── Settings modal (lazily injected into DOM) ── */

  let _modalInjected = false;

  function _injectModal() {
    if (_modalInjected) return;
    _modalInjected = true;

    const overlay = document.createElement('div');
    overlay.id    = 'novus-settings-overlay';
    overlay.innerHTML = `
      <div class="ns-modal">
        <div class="ns-header">
          <h3>⚙ Settings</h3>
          <button class="ns-close" onclick="NovusSettings.closeModal()">✕</button>
        </div>
        <div class="ns-body">
          <div class="ns-section">
            <div class="ns-section-title">Identity</div>
            <label class="ns-field-label">Your Name / ID</label>
            <input type="text" class="ns-input" id="ns-username" placeholder="Enter your name...">
            <div class="ns-hint">Attached to all Supabase records and reports</div>
          </div>
          <div class="ns-section">
            <div class="ns-section-title">Appearance</div>
            <div class="ns-toggle-row">
              <div>
                <div class="ns-toggle-label">Theme</div>
                <div class="ns-hint" style="margin-top:2px">Dark or light mode</div>
              </div>
              <div class="ns-theme-switch" id="ns-theme-switch" onclick="NovusSettings._toggleTheme()">
                <span class="ns-switch-option" data-val="dark">🌙 Dark</span>
                <span class="ns-switch-option" data-val="light">☀️ Light</span>
                <div class="ns-switch-slider" id="ns-switch-slider"></div>
              </div>
            </div>
          </div>
          <div class="ns-section">
            <div class="ns-section-title">Preferences</div>
            <div class="ns-toggle-row">
              <div>
                <div class="ns-toggle-label">Haptic Feedback</div>
                <div class="ns-hint" style="margin-top:2px">Vibrate on taps (mobile)</div>
              </div>
              <label class="ns-checkbox">
                <input type="checkbox" id="ns-haptic"
                       onchange="NovusSettings.set('hapticFeedback',this.checked)">
                <span class="ns-check-slider"></span>
              </label>
            </div>
            <div class="ns-toggle-row" style="margin-top:10px">
              <div>
                <div class="ns-toggle-label">Compact Mode</div>
                <div class="ns-hint" style="margin-top:2px">Smaller spacing</div>
              </div>
              <label class="ns-checkbox">
                <input type="checkbox" id="ns-compact"
                       onchange="NovusSettings.set('compactMode',this.checked)">
                <span class="ns-check-slider"></span>
              </label>
            </div>
          </div>
          <div class="ns-section">
            <div class="ns-section-title">Data</div>
            <button class="ns-danger-btn" onclick="NovusSettings._clearCache()">
              🗑 Clear Local Cache
            </button>
            <div class="ns-hint" style="margin-top:6px">
              App v3.0 · Supabase Edition · Plant 1730
            </div>
          </div>
        </div>
        <div class="ns-footer">
          <button class="ns-save-btn" onclick="NovusSettings._save()">Save & Close</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    const style       = document.createElement('style');
    style.textContent = `
      #novus-settings-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);
        backdrop-filter:blur(6px);z-index:9999;align-items:center;justify-content:center;padding:20px}
      #novus-settings-overlay.open{display:flex}
      #novus-settings-overlay .ns-modal{transform:translateY(12px) scale(.97);opacity:0;
        transition:transform .22s cubic-bezier(.34,1.3,.64,1),opacity .18s ease}
      #novus-settings-overlay.open .ns-modal{transform:none;opacity:1}
      .ns-modal{background:var(--surface);width:100%;max-width:480px;border-radius:16px;
        border:1.5px solid var(--border);display:flex;flex-direction:column;
        max-height:90vh;overflow:hidden}
      .ns-header{padding:16px 20px;border-bottom:1px solid var(--border);
        display:flex;justify-content:space-between;align-items:center}
      .ns-header h3{font-size:16px;font-weight:800;color:var(--text)}
      .ns-close{background:none;border:none;color:var(--text-3);font-size:18px;
        font-weight:900;cursor:pointer}
      .ns-body{padding:0;overflow-y:auto;flex:1}
      .ns-section{padding:16px 20px;border-bottom:1px solid var(--border)}
      .ns-section:last-child{border-bottom:none}
      .ns-section-title{font-size:9px;font-weight:800;text-transform:uppercase;
        letter-spacing:1.5px;color:var(--accent);margin-bottom:12px}
      .ns-field-label{font-size:8px;font-weight:700;text-transform:uppercase;
        letter-spacing:1.2px;color:var(--text-3);display:block;margin-bottom:6px}
      .ns-input{width:100%;padding:12px 14px;background:var(--surface-2);
        border:1.5px solid var(--border);border-radius:10px;font-size:14px;
        font-weight:600;color:var(--text);outline:none;font-family:inherit;
        transition:border-color .15s}
      .ns-input:focus{border-color:var(--accent)}
      .ns-hint{font-size:9px;color:var(--text-3);margin-top:4px}
      .ns-toggle-row{display:flex;justify-content:space-between;align-items:center}
      .ns-toggle-label{font-size:12px;font-weight:700;color:var(--text)}
      .ns-theme-switch{display:flex;position:relative;background:var(--surface-2);
        border-radius:8px;border:1px solid var(--border);overflow:hidden;
        cursor:pointer;user-select:none}
      .ns-switch-option{padding:6px 14px;font-size:10px;font-weight:800;
        color:var(--text-3);position:relative;z-index:2;transition:color .2s}
      .ns-switch-option.active{color:#fff}
      .ns-switch-slider{position:absolute;top:2px;left:2px;width:calc(50% - 2px);
        height:calc(100% - 4px);background:var(--accent);border-radius:6px;
        transition:transform .2s ease;z-index:1}
      .ns-switch-slider.right{transform:translateX(100%)}
      .ns-checkbox{position:relative;width:44px;height:24px;flex-shrink:0}
      .ns-checkbox input{opacity:0;width:0;height:0}
      .ns-check-slider{position:absolute;inset:0;background:var(--surface-3);
        border-radius:12px;cursor:pointer;transition:background .2s}
      .ns-check-slider::after{content:'';position:absolute;width:18px;height:18px;
        border-radius:50%;background:#fff;top:3px;left:3px;transition:transform .2s}
      .ns-checkbox input:checked+.ns-check-slider{background:var(--accent)}
      .ns-checkbox input:checked+.ns-check-slider::after{transform:translateX(20px)}
      .ns-danger-btn{width:100%;padding:10px;background:var(--red-bg);color:var(--red);
        border:1px solid var(--red-border);border-radius:8px;font-size:11px;
        font-weight:800;cursor:pointer;font-family:inherit}
      .ns-footer{padding:12px 20px;border-top:1px solid var(--border)}
      .ns-save-btn{width:100%;padding:14px;background:var(--accent);color:#fff;
        border:none;border-radius:10px;font-size:13px;font-weight:800;
        cursor:pointer;font-family:inherit}`;
    document.head.appendChild(style);
  }

  function openModal() {
    _injectModal();
    document.getElementById('novus-settings-overlay').classList.add('open');
    document.getElementById('ns-username').value = get('userName');
    document.getElementById('ns-haptic').checked  = get('hapticFeedback');
    document.getElementById('ns-compact').checked = get('compactMode');
    _updateThemeSwitch();
    requestAnimationFrame(() => {
      const el = document.getElementById('ns-username');
      if (el) el.focus();
    });
  }

  function closeModal() {
    const o = document.getElementById('novus-settings-overlay');
    if (o) o.classList.remove('open');
  }

  function _updateThemeSwitch() {
    const slider = document.getElementById('ns-switch-slider');
    if (!slider) return;
    slider.classList.toggle('right', get('theme') === 'light');
    document.querySelectorAll('.ns-switch-option').forEach(o =>
      o.classList.toggle('active', o.dataset.val === get('theme'))
    );
  }

  function _toggleTheme() {
    set('theme', get('theme') === 'dark' ? 'light' : 'dark');
    _updateThemeSwitch();
  }

  function _save() {
    const u = document.getElementById('ns-username');
    if (u) set('userName', u.value.trim());
    closeModal();
    if (typeof window.toast === 'function') window.toast('Settings saved', 'green');
    window.dispatchEvent(new CustomEvent('novus-settings-changed'));
  }

  function _clearCache() {
    if (!confirm('Clear all local cache? (Supabase data is unaffected)')) return;
    ['novus_sap', 'novus_done', 'novus_queue'].forEach(k => localStorage.removeItem(k));
    if (typeof window.toast === 'function') window.toast('Local cache cleared', 'amber');
  }

  // Apply theme on first load (before any page script runs)
  applyTheme();

  return {
    get, set, getUser, applyTheme,
    openModal, closeModal, _toggleTheme, _save, _clearCache,
  };
})();


/* ─────────────────────────────────────────────────────
   TOAST
   Single shared DOM element.
   Animates with transform + opacity only (GPU layer).
   Never touches layout properties.
───────────────────────────────────────────────────── */

window.toast = (() => {
  let el = null, textEl = null, tid = null;

  function ensure() {
    if (el) return;
    el          = document.createElement('div');
    el.id       = 'novus-toast';
    el.innerHTML = '<span></span>';
    document.body.appendChild(el);
    textEl = el.querySelector('span');

    const s       = document.createElement('style');
    s.textContent = `
      #novus-toast{
        position:fixed;top:16px;left:50%;
        transform:translateX(-50%) translateY(-8px);
        padding:10px 20px;border-radius:12px;
        font-size:12px;font-weight:700;
        font-family:'DM Sans',sans-serif;
        z-index:99998;pointer-events:none;opacity:0;
        transition:opacity .2s ease,transform .2s cubic-bezier(.34,1.3,.64,1);
        white-space:nowrap;
      }
      #novus-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
      #novus-toast.green{background:rgba(52,211,153,.12);color:#34d399;border:1px solid rgba(52,211,153,.25)}
      #novus-toast.red  {background:rgba(248,113,113,.12);color:#f87171;border:1px solid rgba(248,113,113,.25)}
      #novus-toast.amber{background:rgba(251,191,36,.12);color:#fbbf24;border:1px solid rgba(251,191,36,.25)}
      #novus-toast.blue {background:rgba(91,154,255,.12);color:#5b9aff;border:1px solid rgba(91,154,255,.2)}
      [data-theme="light"] #novus-toast.green{background:rgba(5,150,105,.1);color:#059669}
      [data-theme="light"] #novus-toast.red  {background:rgba(220,38,38,.08);color:#dc2626}
      [data-theme="light"] #novus-toast.amber{background:rgba(180,83,9,.08);color:#b45309}
      [data-theme="light"] #novus-toast.blue {background:rgba(37,99,235,.08);color:#2563eb}`;
    document.head.appendChild(s);
  }

  return function toast(msg, color = 'blue') {
    // If DOM isn't ready yet, defer
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => toast(msg, color), { once: true });
      return;
    }
    ensure();
    if (tid) clearTimeout(tid);
    textEl.textContent = msg;
    el.className       = `show ${color}`;
    tid = setTimeout(() => el.classList.remove('show'), 2600);
  };
})();


/* ─────────────────────────────────────────────────────
   UTILITIES
───────────────────────────────────────────────────── */

/**
 * debounce — fires fn only after `delay`ms of silence.
 * Critical for barcode scanner inputs that send rapid keystrokes.
 * Usage: input.addEventListener('input', debounce(handler, 250))
 */
window.debounce = function debounce(fn, delay) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
};

/**
 * haptic — one-liner navigator.vibrate wrapper.
 * Checks the user's hapticFeedback preference before firing.
 */
window.haptic = function haptic(ms = 15) {
  if (NovusSettings.get('hapticFeedback') && navigator.vibrate) {
    navigator.vibrate(ms);
  }
};

/**
 * escHtml — prevent XSS in dynamic HTML strings.
 * Always use this when interpolating user-provided or DB-sourced strings.
 */
window.escHtml = function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

/**
 * fmtDate — format an ISO timestamp to readable local string.
 */
window.fmtDate = function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
};
