/**
 * ════════════════════════════════════════════════════════════════════════
 *  novus-db.js  ·  Supabase client wrapper for Novus Ops 1730
 *  ─────────────────────────────────────────────────────────────────────
 *  Thin facade over @supabase/supabase-js. Every function mirrors the
 *  shape of the old fetch(API_URL + ...) calls from the Apps Script era,
 *  so page-level code barely changes during migration.
 *
 *  LOAD ORDER in HTML:
 *      <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *      <script src="novus-core.js"></script>
 *      <script src="novus-db.js"></script>
 *      <script>... your page code ...</script>
 *
 *  EXPORTS (globals):
 *      NovusDB.sap.*          — SAP master data + meta
 *      NovusDB.audit.*        — audit log read/write
 *      NovusDB.bins.*         — "bins completed today" tracking
 *      NovusDB.safety.*       — incident reports + photo upload
 *      NovusDB.training.*     — SOPs / flowcharts / slides
 *      NovusDB.assignments.*  — Control Center push-to-team
 *      NovusDB.realtime.*     — subscribe to live updates
 *      NovusDB.dashboard.*    — composite polls for monitor.html
 * ════════════════════════════════════════════════════════════════════════
 */

/* ══════════════════════════════════════════════
   ① CREDENTIALS  —  ⚠ REPLACE BOTH LINES ⚠
   Copy these values from Supabase → Project Settings → API.
   The anon key is safe to put here (it's designed to be public).
════════════════════════════════════════════════ */
const SUPABASE_URL      = 'https://glpprhlezdbsbekjbero.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdscHByaGxlemRic2Jla2piZXJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NDE3NjksImV4cCI6MjA5MjMxNzc2OX0.VebvQRTzBm6VJGyLL1sxKnWwYiYx_Ld2y-hG3zrVxdQ';


/* ══════════════════════════════════════════════
   ② CLIENT BOOT
   Assumes the Supabase UMD bundle has been loaded via <script> tag
   before this file. Exposes window.supabase as the namespace.
════════════════════════════════════════════════ */
if (typeof window.supabase === 'undefined') {
  console.error('[NovusDB] Supabase client library not loaded. ' +
    'Add <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> ' +
    'BEFORE novus-db.js.');
}

const _db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },      // we're not using auth
  realtime: { params: { eventsPerSecond: 10 } },
});


/* ══════════════════════════════════════════════
   ③ ERROR HELPER
   Every method logs + toasts on failure, then returns null/false
   so callers can branch cleanly instead of wrapping in try/catch.
════════════════════════════════════════════════ */
function _err(scope, error) {
  console.error(`[NovusDB:${scope}]`, error);
  if (typeof toast === 'function') {
    toast(`DB error: ${error.message || scope}`, 'red');
  }
}


/* ══════════════════════════════════════════════
   ④ SAP MASTER  —  SAP export snapshot
════════════════════════════════════════════════ */
const sap = {

  /**
   * Replace the entire SAP snapshot with a new upload.
   * rows: array of tuples matching the legacy format:
   *   [bin, hu, product, batch, desc, qty, unit, stockType, grDate, sled]
   * Also writes a new sap_meta row so the Control Center freshness
   * badge picks it up.
   *
   * Returns { success: true, rowCount } on success, { success: false, error } on failure.
   */
  async replaceSnapshot(rows, uploader, filename) {
    try {
      // 1. Wipe existing snapshot
      const { error: delErr } = await _db.from('sap_master').delete().gte('id', 0);
      if (delErr) throw delErr;

      // 2. Map legacy tuples → row objects
      const objects = rows.map(r => ({
        sap_bin:     String(r[0] || '').trim().toUpperCase(),
        hu:          String(r[1] || '').trim(),
        product:     String(r[2] || '').trim(),
        batch:       String(r[3] || '').trim(),
        description: String(r[4] || '').trim(),
        sap_qty:     Number(r[5]) || 0,
        unit:        String(r[6] || 'LB').trim(),
        stock_type:  String(r[7] || '').trim(),
        gr_date:     String(r[8] || ''),
        sled:        String(r[9] || ''),
      })).filter(o => o.sap_bin && o.hu);

      // 3. Chunked insert — Postgres handles 1000-row batches well
      const CHUNK = 1000;
      for (let i = 0; i < objects.length; i += CHUNK) {
        const batch = objects.slice(i, i + CHUNK);
        const { error } = await _db.from('sap_master').insert(batch);
        if (error) throw error;
      }

      // 4. Update meta (singleton row, id = 1)
      const { error: metaErr } = await _db.from('sap_meta').update({
        row_count:   objects.length,
        uploader:    uploader || 'unknown',
        filename:    filename || '',
        uploaded_at: new Date().toISOString(),
      }).eq('id', 1);
      if (metaErr) throw metaErr;

      return { success: true, rowCount: objects.length };
    } catch (err) {
      _err('sap.replaceSnapshot', err);
      return { success: false, error: err.message };
    }
  },

  /** Fetch entire SAP master snapshot (used by scanner on boot). */
  async fetchAll() {
    const { data, error } = await _db.from('sap_master').select('*');
    if (error) { _err('sap.fetchAll', error); return []; }
    // Shape back to scanner's expected field names
    return (data || []).map(r => ({
      sapBin:  r.sap_bin,
      hu:      r.hu,
      product: r.product,
      batch:   r.batch,
      desc:    r.description,
      sapQty:  r.sap_qty,
      unit:    r.unit,
      sled:    r.sled,
    }));
  },

  /** Get the meta (timestamp, uploader, row count) for the freshness badge. */
  async fetchMeta() {
    const { data, error } = await _db.from('sap_meta').select('*').eq('id', 1).single();
    if (error) { _err('sap.fetchMeta', error); return null; }
    return {
      timestamp: data.uploaded_at,
      rowCount:  data.row_count,
      uploader:  data.uploader,
      filename:  data.filename,
    };
  },
};


/* ══════════════════════════════════════════════
   ⑤ AUDIT LOG  —  append-only audit events
════════════════════════════════════════════════ */
const audit = {

  /**
   * Log one bin's worth of audit items.
   * Mirrors the old POST {action:'logAudit', ...} payload shape.
   * Items are validated and inserted in a single multi-row insert.
   *
   * Returns { success: true, inserted } or { success: false, error }.
   * If idempotencyKey is duplicate (e.g. retry), returns { success: true, skipped: true }.
   */
  async log({ user, bin, aisle, auditMode, sessionId, idempotencyKey, items }) {
    if (!items || !items.length) return { success: true, inserted: 0 };

    try {
      const rows = items.map(i => ({
        user_name:       user || 'unknown',
        session_id:      sessionId,
        idempotency_key: `${idempotencyKey}|${i.hu || 'nohu'}|${i.type}`,
        bin:             bin,
        aisle:           aisle,
        audit_mode:      auditMode,
        hu:              i.hu,
        product:         i.product,
        description:     i.desc,
        batch:           i.batch,
        sap_bin:         i.sapBin,
        sap_qty:         Number(i.sapQty) || 0,
        count_qty:       Number(i.countQty) || 0,
        unit:            i.unit,
        type:            i.type,
        note:            i.note,
        sled:            i.sled,
        sled_status:     i.sledStatus,
      }));

      // Use upsert on the idempotency_key unique index → duplicate retries are no-ops
      const { data, error } = await _db
        .from('audit_log')
        .upsert(rows, { onConflict: 'idempotency_key', ignoreDuplicates: true })
        .select('id');

      if (error) throw error;

      const insertedCount = (data || []).length;
      return {
        success:  true,
        inserted: insertedCount,
        skipped:  insertedCount < rows.length,
      };
    } catch (err) {
      _err('audit.log', err);
      return { success: false, error: err.message };
    }
  },

  /** Fetch today's audit events, newest first. Used by Control Center. */
  async fetchToday() {
    const { data, error } = await _db
      .from('v_audit_today')
      .select('*')
      .limit(2000);
    if (error) { _err('audit.fetchToday', error); return []; }
    // Shape to the legacy `report` array format the monitor expects
    return (data || []).map(r => ({
      timestamp:  r.timestamp,
      user:       r.user_name,
      scanBin:    r.bin,
      aisle:      r.aisle,
      hu:         r.hu,
      prod:       r.product,
      desc:       r.description,
      batch:      r.batch,
      sapQty:     r.sap_qty,
      scanQty:    r.count_qty,
      unit:       r.unit,
      type:       r.type,
      note:       r.note,
      sled:       r.sled,
      sledStatus: r.sled_status,
      auditMode:  r.audit_mode,
    }));
  },

  /**
   * Promote all missing_temp items to missing (reconciliation step).
   * Called from Control Center → "Finalize Missing Items" button.
   */
  async finalizeReconciliation(user) {
    try {
      const { data, error } = await _db
        .from('audit_log')
        .update({ type: 'missing' })
        .eq('type', 'missing_temp')
        .select('id');
      if (error) throw error;
      return { success: true, finalized: (data || []).length };
    } catch (err) {
      _err('audit.finalizeReconciliation', err);
      return { success: false, error: err.message };
    }
  },
};


/* ══════════════════════════════════════════════
   ⑥ BINS COMPLETED  —  "already counted today"
════════════════════════════════════════════════ */
const bins = {
  async markCompleted(user, bin) {
    const { error } = await _db.from('bins_completed').insert({
      user_name: user, bin,
    });
    if (error && error.code !== '23505') _err('bins.markCompleted', error);
    // 23505 = unique violation = already recorded → ignore
  },

  /** Returns array of bin names completed today (across all users). */
  async fetchToday() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { data, error } = await _db
      .from('bins_completed')
      .select('bin')
      .gte('completed_at', startOfDay.toISOString());
    if (error) { _err('bins.fetchToday', error); return []; }
    return [...new Set((data || []).map(r => r.bin))];
  },
};


/* ══════════════════════════════════════════════
   ⑦ SAFETY INCIDENTS
════════════════════════════════════════════════ */
const safety = {

  /** Insert a new incident report. Handles photo upload to Storage if present. */
  async create({ id, reportedBy, location, description, severity, incidentType,
                 resolution, status, photoBase64 }) {
    try {
      let photoUrl = '';

      // If a photo is attached (data URL), upload to Storage bucket first
      if (photoBase64 && photoBase64.startsWith('data:image/')) {
        const contentType = photoBase64.match(/^data:(image\/\w+);/)?.[1] || 'image/jpeg';
        const ext         = contentType.split('/')[1] || 'jpg';
        const blob        = _dataUrlToBlob(photoBase64);
        const filename    = `${id}.${ext}`;

        const { error: upErr } = await _db.storage
          .from('incident-photos')
          .upload(filename, blob, { contentType, upsert: true });
        if (upErr) throw upErr;

        const { data: pub } = _db.storage
          .from('incident-photos')
          .getPublicUrl(filename);
        photoUrl = pub.publicUrl;
      }

      const { error } = await _db.from('incidents').upsert({
        id, reported_by: reportedBy, location, description,
        severity, incident_type: incidentType, resolution,
        status: status || 'open', photo_url: photoUrl,
      });
      if (error) throw error;

      return { success: true, id, photoUrl };
    } catch (err) {
      _err('safety.create', err);
      return { success: false, error: err.message };
    }
  },

  /** Fetch all incidents, newest first. */
  async fetchAll() {
    const { data, error } = await _db
      .from('incidents')
      .select('*')
      .order('timestamp', { ascending: false });
    if (error) { _err('safety.fetchAll', error); return []; }
    // Shape to legacy field names
    return (data || []).map(r => ({
      id:           r.id,
      timestamp:    r.timestamp,
      reportedBy:   r.reported_by,
      location:     r.location,
      description:  r.description,
      severity:     r.severity,
      incidentType: r.incident_type,
      resolution:   r.resolution,
      status:       r.status,
      photoUrl:     r.photo_url,
    }));
  },

  /** Count of currently-open incidents. Drives the sidebar summary. */
  async openCount() {
    const { count, error } = await _db
      .from('incidents')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open');
    if (error) { _err('safety.openCount', error); return 0; }
    return count || 0;
  },
};

/* Helper: data URL → Blob (for Storage upload) */
function _dataUrlToBlob(dataUrl) {
  const [header, b64]  = dataUrl.split(',');
  const contentType    = header.match(/^data:(.*?);/)?.[1] || 'application/octet-stream';
  const binary         = atob(b64);
  const bytes          = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}


/* ══════════════════════════════════════════════
   ⑧ TRAINING MODULES
════════════════════════════════════════════════ */
const training = {
  async fetchAll() {
    const { data, error } = await _db
      .from('training_modules')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) { _err('training.fetchAll', error); return []; }
    return (data || []).map(r => ({
      id:        r.id,
      title:     r.title,
      category:  r.category,
      type:      r.type,
      body:      r.body,
      mermaid:   r.mermaid,
      slides:    r.slides || [],
      updatedAt: r.updated_at,
    }));
  },

  /** Replace the full training library with a new array. */
  async saveAll(modules) {
    try {
      // Wipe + re-insert is simplest given how the Control Center edits them
      const { error: delErr } = await _db.from('training_modules').delete().gte('id', '');
      if (delErr) throw delErr;
      if (!modules.length) return { success: true };
      const rows = modules.map(m => ({
        id:         m.id,
        title:      m.title,
        category:   m.category,
        type:       m.type,
        body:       m.body || '',
        mermaid:    m.mermaid || '',
        slides:     m.slides || [],
        updated_at: m.updatedAt || new Date().toISOString(),
      }));
      const { error } = await _db.from('training_modules').insert(rows);
      if (error) throw error;
      return { success: true };
    } catch (err) {
      _err('training.saveAll', err);
      return { success: false, error: err.message };
    }
  },
};


/* ══════════════════════════════════════════════
   ⑨ ASSIGNMENTS  —  Control Center push-to-team
════════════════════════════════════════════════ */
const assignments = {
  async fetchAll() {
    const { data, error } = await _db
      .from('assignments')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { _err('assignments.fetchAll', error); return []; }
    return data || [];
  },

  /** Replace the entire assignment list with a new push. */
  async replaceAll(assignmentList, assignedBy) {
    try {
      const { error: delErr } = await _db.from('assignments').delete().gte('id', 0);
      if (delErr) throw delErr;
      if (!assignmentList.length) return { success: true };
      const rows = assignmentList.map(a => ({
        type: a.type, value: a.value,
        description: a.description, assigned_by: assignedBy,
      }));
      const { error } = await _db.from('assignments').insert(rows);
      if (error) throw error;
      return { success: true };
    } catch (err) {
      _err('assignments.replaceAll', err);
      return { success: false, error: err.message };
    }
  },
};


/* ══════════════════════════════════════════════
   ⑩ REALTIME SUBSCRIPTIONS
   Use these from monitor.html to get live updates
   WITHOUT polling. Each returns a channel handle
   you can call .unsubscribe() on.
════════════════════════════════════════════════ */
const realtime = {
  /**
   * Subscribe to audit_log changes.
   * callback(row) fires on every insert.
   */
  onAuditInsert(callback) {
    return _db
      .channel('audit-log-stream')
      .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'audit_log' },
          payload => callback(payload.new))
      .subscribe();
  },

  /** Incident stream — fires on insert OR update (status changes). */
  onIncidentChange(callback) {
    return _db
      .channel('incidents-stream')
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'incidents' },
          payload => callback(payload.new || payload.old))
      .subscribe();
  },

  /** Assignment stream — for scanner.html to see new pushes live. */
  onAssignmentChange(callback) {
    return _db
      .channel('assignments-stream')
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'assignments' },
          payload => callback(payload.new))
      .subscribe();
  },

  /** SAP freshness — fires when someone uploads new SAP data. */
  onSapMetaUpdate(callback) {
    return _db
      .channel('sap-meta-stream')
      .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'sap_meta' },
          payload => callback(payload.new))
      .subscribe();
  },
};


/* ══════════════════════════════════════════════
   ⑪ DASHBOARD COMPOSITE
   Convenience method that fans out to multiple tables
   in parallel for the Control Center's initial load.
════════════════════════════════════════════════ */
const dashboard = {
  async fetchAll() {
    const [sapMeta, report, assignmentList, safetyOpen] = await Promise.all([
      sap.fetchMeta(),
      audit.fetchToday(),
      assignments.fetchAll(),
      safety.openCount(),
    ]);
    return { sapMeta, report, assignments: assignmentList, safetyOpen };
  },
};


/* ══════════════════════════════════════════════
   ⑫ HEALTH CHECK  —  call from DevTools to verify
════════════════════════════════════════════════ */
async function _healthCheck() {
  console.group('[NovusDB] Health Check');
  const meta = await sap.fetchMeta();
  console.log('sap_meta row present:', !!meta, meta);
  const report = await audit.fetchToday();
  console.log('audit_log today rows:', report.length);
  const incidents = await safety.fetchAll();
  console.log('incidents rows:', incidents.length);
  console.groupEnd();
  return { ok: !!meta };
}


/* ══════════════════════════════════════════════
   EXPORT  —  attach to window so HTML can use NovusDB.xyz
════════════════════════════════════════════════ */
window.NovusDB = {
  sap, audit, bins, safety, training, assignments, realtime, dashboard,
  _healthCheck,     // exposed for DevTools testing
  _client: _db,     // escape hatch for ad-hoc queries
};
