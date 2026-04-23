/**

- novus-core.js — Novus Ops v2 · Supabase Edition
- Plant 1730 · Buena Park, CA
- 
- Globals provided to every page:
- window.sb           — Supabase client
- window.SESSION_ID   — ‘S-YYYY-MM-DD’ (UTC, resets daily)
- window.AISLE_ROWS   — Plant 1730 aisle letters
- window.NovusLoader  — Top-bar progress indicator
- window.NovusSettings— Settings modal + localStorage prefs
- window.toast()      — Notification banner
- 
- Load order in every page:
- 1. <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
- 1. <script src="novus-core.js"></script>
- 1. <script> /* page code * / </script>

*/

‘use strict’;

/* ─────────────────────────────────────────────────────
★ CONFIGURATION — fill in your Supabase project values
───────────────────────────────────────────────────── */
const SUPABASE_URL      = ‘https://mnkxobbolxmhisqerkal.supabase.co’;
const SUPABASE_ANON_KEY = ‘eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ua3hvYmJvbHhtaGlzcWVya2FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5MDU5NTIsImV4cCI6MjA5MjQ4MTk1Mn0.fmdg2ludtpHTyiJJ2FGh8QpndSOO4mQdpkf3bJgHT2c’;

/* ─────────────────────────────────────────────────────
SUPABASE CLIENT
───────────────────────────────────────────────────── */
window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
auth:     { persistSession: false, autoRefreshToken: false },
realtime: { heartbeatIntervalMs: 15000 },
});

/* ─────────────────────────────────────────────────────
CONSTANTS
───────────────────────────────────────────────────── */

// Session ID rolls over at midnight UTC — one counting session per day
window.SESSION_ID = ‘S-’ + new Date().toISOString().split(‘T’)[0];

// Plant 1730 warehouse aisle letters (skip I to avoid barcode confusion)
window.AISLE_ROWS = [‘A’,‘B’,‘C’,‘D’,‘E’,‘F’,‘G’,‘H’,‘J’,‘K’,‘L’,‘M’,‘N’];

/* ═════════════════════════════════════════════════════
TOAST  —  hardware-accelerated notification banner
Usage: toast(‘Saved!’, ‘green’)
Types: green | red | blue | amber | pink
═════════════════════════════════════════════════════ */
(function _ensureToastDOM() {
function _inject() {
if (document.getElementById(‘toast’)) return;
const el = document.createElement(‘div’);
el.id = ‘toast’;
el.className = ‘toast’;
el.innerHTML = ‘<span id="toast-text"></span>’;
document.body.appendChild(el);
}
document.readyState === ‘loading’
? document.addEventListener(‘DOMContentLoaded’, _inject)
: _inject();
})();

let _toastTimer = null;
function toast(msg, type = ‘blue’, duration = 3000) {
const el   = document.getElementById(‘toast’);
const text = document.getElementById(‘toast-text’);
if (!el || !text) return;
if (_toastTimer) clearTimeout(_toastTimer);
text.textContent = msg;
el.className = ’toast ’ + type;
void el.offsetWidth;
el.classList.add(‘show’);
_toastTimer = setTimeout(() => { el.classList.remove(‘show’); _toastTimer = null; }, duration);
}
window.toast = toast;

/* ═════════════════════════════════════════════════════
NOVUS LOADER  —  thin top-bar progress indicator
NovusLoader.start()  — call before async work
NovusLoader.done()   — call in finally{}
Stacking-safe: N starts require N dones.
═════════════════════════════════════════════════════ */
const NovusLoader = (() => {
let _depth = 0, _bar = null, _timer = null;

function _ensureBar() {
if (_bar) return;
_bar = document.createElement(‘div’);
_bar.id = ‘_nv_loader’;
Object.assign(_bar.style, {
position: ‘fixed’, top: ‘0’, left: ‘0’,
height: ‘3px’, width: ‘0%’,
background: ‘var(–accent, #00e5ff)’,
zIndex: ‘9999’, pointerEvents: ‘none’,
transition: ‘width .45s ease, opacity .3s ease’,
opacity: ‘0’, willChange: ‘width, opacity’,
});
(document.body || document.addEventListener(‘DOMContentLoaded’,
() => document.body.appendChild(_bar))) && document.body.appendChild(_bar);
}

function start() {
_ensureBar();
_depth++;
if (_timer) { clearTimeout(_timer); _timer = null; }
_bar.style.opacity = ‘1’;
requestAnimationFrame(() => { _bar.style.width = ‘75%’; });
}

function done() {
_ensureBar();
if (_depth > 0) _depth–;
if (_depth > 0) return;
_bar.style.width = ‘100%’;
_timer = setTimeout(() => {
_bar.style.opacity = ‘0’;
setTimeout(() => { if (_depth === 0) _bar.style.width = ‘0%’; }, 300);
_timer = null;
}, 250);
}

/**

- Returns placeholder HTML for the aisle grid while SAP data loads.
- Matches .aisle-btn structure in scanner.html v2.
  */
  function skeletonAisleCards(n) {
  return window.AISLE_ROWS.slice(0, n).map(letter => `
  <button class="aisle-btn" style="pointer-events:none;cursor:default;opacity:.45" disabled>
  <span class="a-letter">${letter}</span>
  <span class="a-count">—/—</span>
  
     <div class="aisle-prog" style="width:0%"></div>
   </button>`).join('');

}

return { start, done, skeletonAisleCards };
})();
window.NovusLoader = NovusLoader;

/* ═════════════════════════════════════════════════════
NOVUS SETTINGS  —  localStorage prefs + settings modal
NovusSettings.openModal()    — show settings overlay
NovusSettings.closeModal()   — hide it
NovusSettings.saveAndClose() — commit + close
NovusSettings.getUser()      — returns saved name
NovusSettings.get(key)       — read any pref
NovusSettings.set(key, val)  — write pref + fire event
Fires: window event ‘novus-settings-changed’
═════════════════════════════════════════════════════ */
const NovusSettings = (() => {
const STORAGE_KEY = ‘novus_prefs_v2’;
const DEFAULTS    = { userName: ‘’, hapticFeedback: true, compactMode: false };

function *load() {
try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(STORAGE_KEY) || ‘{}’)); }
catch (*) { return { …DEFAULTS }; }
}
function *persist(p) {
try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch (*) {}
}

let _prefs = _load();

function get(key)      { return _prefs[key]; }
function getUser()     { return _prefs.userName || ‘’; }
function set(key, val) {
_prefs[key] = val;
_persist(_prefs);
_applyPrefs();
window.dispatchEvent(new CustomEvent(‘novus-settings-changed’, { detail: { key, val } }));
}
function _applyPrefs() {
document.body.classList.toggle(‘compact-mode’, !!_prefs.compactMode);
}

/* ── Modal (lazily injected) ── */
function _buildModal() {
const overlay = document.createElement(‘div’);
overlay.id = ‘_nv_overlay’;
Object.assign(overlay.style, {
display: ‘none’, position: ‘fixed’, inset: ‘0’,
background: ‘rgba(0,0,0,.8)’, backdropFilter: ‘blur(8px)’,
zIndex: ‘10000’, alignItems: ‘center’, justifyContent: ‘center’, padding: ‘20px’,
});
overlay.innerHTML = ` <div id="_nv_box" style=" background:var(--surface,#1a1f2e);width:100%;max-width:400px; border-radius:20px;border:1px solid var(--border,rgba(255,255,255,.055)); box-shadow:0 32px 80px rgba(0,0,0,.75);overflow:hidden; animation:_nv_rise .25s cubic-bezier(.34,1.56,.64,1);"> <style> @keyframes _nv_rise{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}} ._nv_toggle{width:52px;height:28px;border-radius:14px;border:none;cursor:pointer; position:relative;transition:background .2s;flex-shrink:0} ._nv_knob{position:absolute;top:3px;left:3px;width:22px;height:22px; background:#fff;border-radius:50%;transition:transform .2s; box-shadow:0 2px 4px rgba(0,0,0,.3);pointer-events:none} ._nv_row{display:flex;justify-content:space-between;align-items:center} ._nv_label{font-size:13px;font-weight:600;color:var(--text,#e1e5f0);font-family:'DM Sans',sans-serif} ._nv_field{width:100%;padding:12px 14px; background:var(--surface-2,#1f2538);border:1.5px solid var(--border,rgba(255,255,255,.055)); border-radius:12px;font-size:15px;font-weight:600;color:var(--text,#e1e5f0); outline:none;font-family:'DM Sans',sans-serif;transition:border-color .15s;box-sizing:border-box} </style> <div style="padding:16px 20px;border-bottom:1px solid var(--border,rgba(255,255,255,.055)); display:flex;justify-content:space-between;align-items:center"> <span style="font-size:15px;font-weight:800;color:var(--text,#e1e5f0);font-family:'DM Sans',sans-serif">⚙ Settings</span> <button onclick="NovusSettings.closeModal()" style="background:none;color:var(--text-3,#4a5568);font-size:18px;font-weight:900;border:none;cursor:pointer;line-height:1">✕</button> </div> <div style="padding:20px;display:flex;flex-direction:column;gap:16px"> <div> <div style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-3,#4a5568);margin-bottom:7px;font-family:'DM Sans',sans-serif">Your Name / Badge ID</div> <input id="_nv_name" type="text" class="_nv_field" placeholder="Enter your name…" onfocus="this.style.borderColor='var(--accent,#00e5ff)'" onblur="this.style.borderColor='var(--border,rgba(255,255,255,.055))'"> </div> <div class="_nv_row"> <span class="_nv_label">Haptic Feedback</span> <button id="_nv_haptic" class="_nv_toggle" onclick="NovusSettings._toggle('hapticFeedback','_nv_haptic')"><div class="_nv_knob"></div></button> </div> <div class="_nv_row"> <span class="_nv_label">Compact Mode</span> <button id="_nv_compact" class="_nv_toggle" onclick="NovusSettings._toggle('compactMode','_nv_compact')"><div class="_nv_knob"></div></button> </div> <div style="font-size:9px;color:var(--text-3,#4a5568);text-align:center;font-family:'DM Sans',sans-serif;margin-top:4px"> Novus Foods · Plant 1730 · Supabase v2 </div> </div> <div style="padding:14px 20px;border-top:1px solid var(--border,rgba(255,255,255,.055))"> <button onclick="NovusSettings.saveAndClose()" style=" width:100%;padding:14px;border-radius:12px; background:var(--teal,#0d9488);color:#fff; font-size:13px;font-weight:800;border:none;cursor:pointer; font-family:'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.5px; transition:filter .15s">Save Settings</button> </div> </div>`;
overlay.addEventListener(‘click’, e => { if (e.target === overlay) closeModal(); });
return overlay;
}

function _updateToggleUI(id, val) {
const btn = document.getElementById(id); if (!btn) return;
const knob = btn.querySelector(’._nv_knob’);
btn.style.background = val ? ‘var(–teal,#0d9488)’ : ‘var(–surface-3,#252c3e)’;
if (knob) knob.style.transform = val ? ‘translateX(24px)’ : ‘translateX(0)’;
}

function _syncModalUI() {
const nameEl = document.getElementById(’_nv_name’);
if (nameEl) nameEl.value = _prefs.userName || ‘’;
_updateToggleUI(’_nv_haptic’,  _prefs.hapticFeedback);
_updateToggleUI(’_nv_compact’, _prefs.compactMode);
}

function openModal() {
if (!document.getElementById(’_nv_overlay’)) document.body.appendChild(_buildModal());
_syncModalUI();
document.getElementById(’_nv_overlay’).style.display = ‘flex’;
}
function closeModal() {
const o = document.getElementById(’_nv_overlay’);
if (o) o.style.display = ‘none’;
}
function saveAndClose() {
const nameEl = document.getElementById(’_nv_name’);
if (nameEl) _prefs.userName = nameEl.value.trim();
_persist(_prefs);
_applyPrefs();
window.dispatchEvent(new CustomEvent(‘novus-settings-changed’, { detail: { …_prefs } }));
closeModal();
toast(`Saved · Hello, ${_prefs.userName || 'there'}! 👋`, ‘green’);
}
function _toggle(key, btnId) {
_prefs[key] = !_prefs[key];
_updateToggleUI(btnId, _prefs[key]);
}

document.addEventListener(‘keydown’, e => { if (e.key === ‘Escape’) closeModal(); });
document.readyState === ‘loading’
? document.addEventListener(‘DOMContentLoaded’, _applyPrefs)
: _applyPrefs();

return { get, set, getUser, openModal, closeModal, saveAndClose, _toggle };
})();
window.NovusSettings = NovusSettings;
