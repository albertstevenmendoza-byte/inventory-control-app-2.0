'use strict';

const SUPABASE_URL      = 'https://qswrdmxeofuxpqpwlyqv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzd3JkbXhlb2Z1eHBxcHdseXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0ODE5NDEsImV4cCI6MjA5MjA1Nzk0MX0.lwWwcFbioA7btr7w85hzVAcYjyv0KPPWL50Q7Q4nZAM';
const PLANT_ID          = '27d1dea0-9276-46ca-ac3a-7c0512f92336';
const RECONCILE_URL     = `${SUPABASE_URL}/functions/v1/reconcile-bin`;
const DB_URL            = `${SUPABASE_URL}/rest/v1`;
const API_URL           = RECONCILE_URL;

let _currentSession = null;

function dbHeaders(jwt) {
  return {
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${jwt || SUPABASE_ANON_KEY}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
  };
}

function fnHeaders(jwt) {
  return {
    'Authorization': `Bearer ${jwt || SUPABASE_ANON_KEY}`,
    'Content-Type':  'application/json',
  };
}

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════
const NovusAuth = (() => {
  async function signIn(email, password) {
    const res  = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method:  'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.access_token) {
      _currentSession = data;
      localStorage.setItem('novus_session', JSON.stringify(data));
      return { success: true, session: data };
    }
    return { success: false, error: data.error_description || 'Login failed' };
  }

  function signOut() {
    _currentSession = null;
    localStorage.removeItem('novus_session');
    window.location.href = 'login.html';
  }

  function getSession() {
    if (_currentSession) return _currentSession;
    try {
      const s = localStorage.getItem('novus_session');
      if (s) { _currentSession = JSON.parse(s); return _currentSession; }
    } catch {}
    return null;
  }

  function getJWT()    { return getSession()?.access_token || null; }
  function getUser()   { return getSession()?.user || null; }
  function isLoggedIn(){ return !!getSession(); }

  return { signIn, signOut, getSession, getJWT, getUser, isLoggedIn };
})();

// ══════════════════════════════════════════════════════════════
// DATABASE
// ══════════════════════════════════════════════════════════════
const NovusDB = (() => {

  async function getSAPData() {
    const jwt = NovusAuth.getJWT();
    const res = await fetch(
      `${DB_URL}/handling_units?plant_id=eq.${PLANT_ID}&select=*&limit=50000`,
      { headers: dbHeaders(jwt) }
    );
    const rows = await res.json();
    return rows.map(r => ({
      sapBin:    r.bin_code,
      hu:        r.hu_number,
      product:   r.sku,
      desc:      r.description || '',
      batch:     r.batch       || '',
      sapQty:    r.quantity    || 0,
      unit:      r.uom         || 'LB',
      sled:      r.sled        || '',
      stockType: r.stock_type  || 'F2',
    }));
  }

  async function uploadSAPData(rows, filename, uploader) {
    const jwt     = NovusAuth.getJWT();
    const records = rows.map(r => ({
      plant_id:     PLANT_ID,
      bin_code:     String(r[0] || '').trim().toUpperCase(),
      hu_number:    String(r[1] || '').trim(),
      sku:          String(r[2] || '').trim(),
      batch:        String(r[3] || '').trim(),
      description:  String(r[4] || '').trim(),
      quantity:     parseFloat(r[5]) || 0,
      uom:          String(r[6] || 'LB').trim(),
      stock_type:   String(r[7] || 'F2').trim(),
      sled:         r[9] ? String(r[9]).trim() : null,
      sap_bin_code: String(r[0] || '').trim().toUpperCase(),
      sap_quantity: parseFloat(r[5]) || 0,
      state:        'ok',
    })).filter(r => r.bin_code && r.hu_number);

    const CHUNK = 500;
    let total = 0;
    for (let i = 0; i < records.length; i += CHUNK) {
      const res = await fetch(`${DB_URL}/handling_units`, {
        method:  'POST',
        headers: { ...dbHeaders(jwt), 'Prefer': 'resolution=merge-duplicates,return=representation' },
        body:    JSON.stringify(records.slice(i, i + CHUNK)),
      });
      if (res.ok) total += Math.min(CHUNK, records.length - i);
    }

    const bins = [...new Set(records.map(r => r.bin_code))].map(b => ({
      plant_id: PLANT_ID,
      bin_code: b,
      aisle:    b.match(/^W([A-Z])/)?.[1] || '',
      active:   true,
    }));
    await fetch(`${DB_URL}/bins`, {
      method:  'POST',
      headers: { ...dbHeaders(jwt), 'Prefer': 'resolution=merge-duplicates' },
      body:    JSON.stringify(bins),
    });

    return { success: true, rowCount: total, filename, uploader };
  }

  async function getReport() {
    const jwt   = NovusAuth.getJWT();
    const today = new Date().toISOString().split('T')[0];
    const res   = await fetch(
      `${DB_URL}/audit_events?plant_id=eq.${PLANT_ID}&scanned_at=gte.${today}T00:00:00&select=*&order=scanned_at.desc&limit=5000`,
      { headers: dbHeaders(jwt) }
    );
    const rows = await res.json();
    return rows.map(r => ({
      timestamp:  r.scanned_at,
      user:       r.auditor_name || '',
      aisle:      r.bin_code?.charAt(1) || '',
      scanBin:    r.bin_code,
      hu:         r.hu_number,
      prod:       r.sku,
      desc:       '',
      sapQty:     r.sap_qty,
      scanQty:    r.scan_qty,
      type:       r.result_state,
      note:       r.note       || '',
      sledStatus: r.sled_status || '',
    }));
  }

  async function logAudit(payload) {
    const jwt = NovusAuth.getJWT();
    const res = await fetch(RECONCILE_URL, {
      method:  'POST',
      headers: fnHeaders(jwt),
      body:    JSON.stringify({
        plant_id:        PLANT_ID,
        session_id:      payload.sessionId,
        bin_code:        payload.bin,
        auditor_id:      payload.auditorId || '',
        auditor_name:    payload.user      || '',
        audit_mode:      payload.auditMode || 'aisle',
        scanned_items:   (payload.items || []).map(i => ({
          hu_number: i.hu,
          scan_qty:  i.countQty,
          note:      i.note || '',
          sled:      i.sled || '',
        })),
        idempotency_key: payload.idempotencyKey,
      }),
    });
    const text = await res.text();
    return JSON.parse(text);
  }

  async function getSafety() {
    const jwt = NovusAuth.getJWT();
    const res = await fetch(
      `${DB_URL}/safety_incidents?plant_id=eq.${PLANT_ID}&order=created_at.desc`,
      { headers: dbHeaders(jwt) }
    );
    const rows = await res.json();
    return rows.map(r => ({
      id:           r.id,
      reportedBy:   r.reporter_name || '',
      location:     r.location      || '',
      incidentType: r.incident_type || '',
      severity:     r.severity      || 'low',
      description:  r.description   || '',
      resolution:   r.resolution    || '',
      status:       r.status        || 'open',
      photoUrl:     r.photo_url     || '',
      timestamp:    r.created_at,
    }));
  }

  async function logSafety(payload) {
    const jwt = NovusAuth.getJWT();
    const res = await fetch(`${DB_URL}/safety_incidents`, {
      method:  'POST',
      headers: dbHeaders(jwt),
      body:    JSON.stringify({
        plant_id:     PLANT_ID,
        reporter_name:payload.reportedBy   || '',
        location:     payload.location     || '',
        incident_type:payload.incidentType || '',
        severity:     payload.severity     || 'low',
        description:  payload.description  || '',
        resolution:   payload.resolution   || '',
        status:       payload.status       || 'open',
        photo_url:    payload.photoUrl     || '',
      }),
    });
    const data = await res.json();
    return { success: res.ok, id: Array.isArray(data) ? data[0]?.id : data?.id };
  }

  async function getAssignments() {
    const jwt = NovusAuth.getJWT();
    const res = await fetch(
      `${DB_URL}/assignments?plant_id=eq.${PLANT_ID}&completed=eq.false`,
      { headers: dbHeaders(jwt) }
    );
    return res.json();
  }

  async function setAssignments(assignments, assignedBy) {
    const jwt = NovusAuth.getJWT();
    await fetch(
      `${DB_URL}/assignments?plant_id=eq.${PLANT_ID}&completed=eq.false`,
      { method: 'DELETE', headers: dbHeaders(jwt) }
    );
    if (!assignments.length) return { success: true };
    const records = assignments.map(a => ({
      plant_id:        PLANT_ID,
      assignment_type: a.type,
      scope_value:     a.value,
      completed:       false,
    }));
    const res = await fetch(`${DB_URL}/assignments`, {
      method:  'POST',
      headers: dbHeaders(jwt),
      body:    JSON.stringify(records),
    });
    return { success: res.ok };
  }

  async function getSAPMeta() {
    const jwt = NovusAuth.getJWT();
    const res = await fetch(
      `${DB_URL}/handling_units?plant_id=eq.${PLANT_ID}&select=updated_at&order=updated_at.desc&limit=1`,
      { headers: dbHeaders(jwt) }
    );
    const rows = await res.json();
    const countRes = await fetch(
      `${DB_URL}/handling_units?plant_id=eq.${PLANT_ID}&select=id`,
      { headers: { ...dbHeaders(jwt), 'Prefer': 'count=exact', 'Range': '0-0' } }
    );
    const count = countRes.headers.get('content-range')?.split('/')?.[1] || 0;
    return { timestamp: rows[0]?.updated_at || null, rowCount: count, uploader: '', filename: '' };
  }

  async function poll() {
    const [report, safety, sapMeta] = await Promise.all([
      getReport(), getSafety(), getSAPMeta(),
    ]);
    return {
      report,
      safetyOpen: safety.filter(i => i.status === 'open').length,
      sapMeta,
    };
  }

  return {
    getSAPData, uploadSAPData,
    getReport,  logAudit,
    getSafety,  logSafety,
    getAssignments, setAssignments,
    getSAPMeta, poll,
  };
})();

// ══════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════
const NovusSettings = (() => {
  const STORAGE_KEY = 'novus_settings';
  const DEFAULTS = {
    userName: '', theme: 'dark',
    hapticFeedback: true, compactMode: false,
  };
  const DARK_VARS = {
    '--bg':'#101420','--bg-2':'#131826',
    '--surface':'#1a1f2e','--surface-2':'#1f2538',
    '--surface-3':'#252c3e','--surface-4':'#2a3142',
    '--border':'rgba(255,255,255,.055)',
    '--border-2':'rgba(255,255,255,.09)',
    '--text':'#e1e5f0','--text-2':'#94a3b8','--text-3':'#4a5568',
    '--accent':'#00e5ff','--accent-dim':'rgba(0,229,255,.07)',
    '--teal':'#0d9488','--teal-dim':'rgba(13,148,136,.1)',
    '--teal-border':'rgba(13,148,136,.3)',
    '--green':'#10b981','--green-bg':'rgba(16,185,129,.08)',
    '--green-border':'rgba(16,185,129,.22)',
    '--red':'#ef4444','--red-bg':'rgba(239,68,68,.08)',
    '--red-border':'rgba(239,68,68,.22)',
    '--amber':'#f59e0b','--amber-bg':'rgba(245,158,11,.08)',
    '--amber-border':'rgba(245,158,11,.22)',
    '--purple':'#a78bfa','--purple-bg':'rgba(167,139,250,.08)',
    '--cyan':'#00e5ff','--cyan-bg':'rgba(0,229,255,.07)',
    '--fresh':'#f472b6','--fresh-bg':'rgba(244,114,182,.08)',
    '--fresh-border':'rgba(244,114,182,.22)',
  };
  const LIGHT_VARS = {
    '--bg':'#f8f9fb','--surface':'#ffffff',
    '--surface-2':'#f1f3f5','--surface-3':'#e5e7eb',
    '--border':'#d1d5dc','--text':'#111827',
    '--text-2':'#374151','--text-3':'#6b7280',
    '--accent':'#0d9488','--accent-dim':'rgba(13,148,136,.07)',
    '--green':'#059669','--green-bg':'rgba(5,150,105,.08)',
    '--red':'#dc2626','--red-bg':'rgba(220,38,38,.07)',
    '--amber':'#b45309','--amber-bg':'rgba(180,83,9,.07)',
  };

  function loadAll() {
    try { const r=localStorage.getItem(STORAGE_KEY); return r?{...DEFAULTS,...JSON.parse(r)}:{...DEFAULTS}; }
    catch { return {...DEFAULTS}; }
  }
  function saveAll(s) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
  let _cache = loadAll();
  function get(key) { return _cache[key]!==undefined?_cache[key]:DEFAULTS[key]; }
  function set(key,val) { _cache[key]=val; saveAll(_cache); if(key==='theme')applyTheme(); }
  function getUser() { return get('userName')||''; }

  function applyTheme() {
    const vars = get('theme')==='light' ? LIGHT_VARS : DARK_VARS;
    Object.entries(vars).forEach(([k,v]) => document.documentElement.style.setProperty(k,v));
    if (document.body) document.body.setAttribute('data-theme', get('theme'));
  }

  function openModal() {
    const ex = document.getElementById('novus-settings-overlay');
    if (ex) { ex.classList.add('open'); _populate(); return; }
    _inject();
  }
  function _populate() {
    const n=document.getElementById('ns-username');
    const h=document.getElementById('ns-haptic');
    if(n)n.value=get('userName');
    if(h)h.checked=get('hapticFeedback');
    _updateSwitch();
  }
  function _inject() {
    const o=document.createElement('div');
    o.id='novus-settings-overlay';
    o.innerHTML=`<div class="ns-modal"><div class="ns-header"><h3>⚙ Settings</h3><button class="ns-close" onclick="NovusSettings.closeModal()">✕</button></div><div class="ns-body"><div class="ns-section"><div class="ns-section-title">Identity</div><label class="ns-field-label">Your Name</label><input type="text" class="ns-input" id="ns-username" placeholder="Your name..."></div><div class="ns-section"><div class="ns-section-title">Appearance</div><div class="ns-toggle-row"><span class="ns-toggle-label">Theme</span><div class="ns-theme-switch" onclick="NovusSettings._toggleTheme()"><span class="ns-switch-option" data-val="dark">🌙 Dark</span><span class="ns-switch-option" data-val="light">☀️ Light</span><div class="ns-switch-slider" id="ns-switch-slider"></div></div></div></div><div class="ns-section"><div class="ns-section-title">Preferences</div><div class="ns-toggle-row"><span class="ns-toggle-label">Haptic Feedback</span><label class="ns-checkbox"><input type="checkbox" id="ns-haptic" onchange="NovusSettings.set('hapticFeedback',this.checked)"><span class="ns-check-slider"></span></label></div></div><div class="ns-section"><button class="ns-danger-btn" onclick="if(confirm('Clear cache?')){localStorage.removeItem('novus_sap');localStorage.removeItem('novus_done');localStorage.removeItem('novus_queue');}">🗑 Clear Cache</button><br><button class="ns-danger-btn" style="margin-top:6px;background:rgba(239,68,68,.15)" onclick="NovusAuth.signOut()">🚪 Sign Out</button></div></div><div class="ns-footer"><button class="ns-save-btn" onclick="NovusSettings._save()">Save &amp; Close</button></div></div>`;
    document.body.appendChild(o);
    const s=document.createElement('style');
    s.textContent=`#novus-settings-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(6px);z-index:9999;align-items:center;justify-content:center;padding:20px}#novus-settings-overlay.open{display:flex}.ns-modal{background:var(--surface);width:100%;max-width:460px;border-radius:16px;border:1.5px solid var(--border);display:flex;flex-direction:column;max-height:90vh;overflow:hidden}.ns-header{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}.ns-header h3{font-size:16px;font-weight:800;color:var(--text)}.ns-close{background:none;border:none;color:var(--text-3);font-size:18px;cursor:pointer}.ns-body{overflow-y:auto;flex:1}.ns-section{padding:14px 20px;border-bottom:1px solid var(--border)}.ns-section-title{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:var(--accent);margin-bottom:10px}.ns-field-label{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-3);display:block;margin-bottom:6px}.ns-input{width:100%;padding:11px 14px;background:var(--surface-2);border:1.5px solid var(--border);border-radius:10px;font-size:14px;font-weight:600;color:var(--text);outline:none;font-family:inherit}.ns-toggle-row{display:flex;justify-content:space-between;align-items:center}.ns-toggle-label{font-size:12px;font-weight:700;color:var(--text)}.ns-theme-switch{display:flex;position:relative;background:var(--surface-2);border-radius:8px;border:1px solid var(--border);overflow:hidden;cursor:pointer;user-select:none}.ns-switch-option{padding:6px 12px;font-size:10px;font-weight:800;color:var(--text-3);position:relative;z-index:2;transition:color .2s}.ns-switch-option.active{color:#fff}.ns-switch-slider{position:absolute;top:2px;left:2px;width:calc(50% - 2px);height:calc(100% - 4px);background:var(--accent);border-radius:6px;transition:transform .2s;z-index:1}.ns-switch-slider.right{transform:translateX(100%)}.ns-checkbox{position:relative;width:44px;height:24px;flex-shrink:0}.ns-checkbox input{opacity:0;width:0;height:0}.ns-check-slider{position:absolute;inset:0;background:var(--surface-3);border-radius:12px;cursor:pointer;transition:background .2s}.ns-check-slider::after{content:'';position:absolute;width:18px;height:18px;border-radius:50%;background:#fff;top:3px;left:3px;transition:transform .2s}.ns-checkbox input:checked+.ns-check-slider{background:var(--accent)}.ns-checkbox input:checked+.ns-check-slider::after{transform:translateX(20px)}.ns-danger-btn{width:100%;padding:9px;background:var(--red-bg);color:var(--red);border:1px solid rgba(239,68,68,.25);border-radius:8px;font-size:11px;font-weight:800;cursor:pointer;font-family:inherit}.ns-footer{padding:12px 20px;border-top:1px solid var(--border)}.ns-save-btn{width:100%;padding:13px;background:var(--accent);color:#101420;border:none;border-radius:10px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit}`;
    document.body.appendChild(s);
    o.classList.add('open');
    _populate();
  }
  function closeModal() { const o=document.getElementById('novus-settings-overlay'); if(o)o.classList.remove('open'); }
  function _updateSwitch() { const s=document.getElementById('ns-switch-slider'); const opts=document.querySelectorAll('.ns-switch-option'); if(!s)return; s.classList.toggle('right',get('theme')==='light'); opts.forEach(o=>o.classList.toggle('active',o.dataset.val===get('theme'))); }
  function _toggleTheme() { set('theme',get('theme')==='dark'?'light':'dark'); _updateSwitch(); }
  function _save() { const n=document.getElementById('ns-username'); if(n)set('userName',n.value.trim()); closeModal(); if(typeof window.toast==='function')window.toast('Settings saved','green'); window.dispatchEvent(new CustomEvent('novus-settings-changed')); }

  applyTheme();
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', applyTheme);

  return { get, set, getUser, applyTheme, openModal, closeModal, _toggleTheme, _save };
})();

// ══════════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════════
window.toast = function(msg, color='blue') {
  const t=document.getElementById('toast'); if(!t)return;
  const x=document.getElementById('toast-text'); if(x)x.textContent=msg;
  t.className=''; void t.offsetWidth;
  t.className=`toast ${color} show`;
  clearTimeout(t._hideTimer);
  t._hideTimer=setTimeout(()=>t.classList.remove('show'),2500);
};

// ══════════════════════════════════════════════════════════════
// LOADER
// ══════════════════════════════════════════════════════════════
const NovusLoader = (() => {
  let _bar=null, _progress=0, _raf=null;
  function _ensureBar() {
    if(_bar)return;
    _bar=document.createElement('div');
    _bar.style.cssText='position:fixed;top:0;left:0;z-index:99999;height:3px;width:0%;background:var(--accent);transition:width .2s ease,opacity .3s ease;border-radius:0 2px 2px 0;box-shadow:0 0 8px var(--accent);pointer-events:none;opacity:0';
    const a=()=>document.body&&document.body.appendChild(_bar);
    document.body?a():document.addEventListener('DOMContentLoaded',a);
  }
  function start() { _ensureBar();_progress=0;_bar.style.opacity='1';_bar.style.width='0%';_crawl(); }
  function _crawl() { if(_progress<75){_progress+=(75-_progress)*0.06;_bar.style.width=_progress+'%';_raf=requestAnimationFrame(()=>setTimeout(_crawl,80));} }
  function done() { cancelAnimationFrame(_raf);if(!_bar)return;_bar.style.transition='width .15s ease,opacity .4s ease .2s';_bar.style.width='100%';setTimeout(()=>{_bar.style.opacity='0';setTimeout(()=>{_bar.style.width='0%';_bar.style.transition='';},400);},150); }
  function skeletonTableRows(cols,rows=6) { const sh='background:linear-gradient(90deg,var(--surface-2) 25%,var(--surface-3) 50%,var(--surface-2) 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;border-radius:5px;height:12px;display:block';const w=['60%','45%','55%','40%','50%','65%','35%','50%','40%','55%'];const cells=Array.from({length:cols},(_,i)=>`<td><span style="${sh};width:${w[i%w.length]}"></span></td>`).join('');return Array.from({length:rows},()=>`<tr>${cells}</tr>`).join(''); }
  function skeletonAisleCards(count=14) { return Array.from({length:count},()=>`<div class="aisle-btn" style="background:linear-gradient(90deg,var(--surface) 25%,var(--surface-2) 50%,var(--surface) 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;color:transparent;pointer-events:none;min-height:72px">&nbsp;</div>`).join(''); }
  const _s=document.createElement('style');
  _s.textContent='@keyframes shimmer{to{background-position:-200% 0}}';
  document.head?document.head.appendChild(_s):document.addEventListener('DOMContentLoaded',()=>document.head.appendChild(_s));
  return { start, done, skeletonTableRows, skeletonAisleCards };
})();

// ══════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════
const AISLE_ROWS = 'ABCDEFGHJKLMNP'.split('');