-- ══════════════════════════════════════════════════════════════════
--  NOVUS OPS v2 — SCHEMA ADDITIONS
--  Run this in Supabase SQL Editor BEFORE deploying the v2 app.
--  Safe to re-run — all statements use IF NOT EXISTS / IF EXISTS.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Add v2 columns to sap_data ──────────────────────────────
ALTER TABLE public.sap_data
  ADD COLUMN IF NOT EXISTS batch               text,
  ADD COLUMN IF NOT EXISTS unit                text DEFAULT 'LB',
  ADD COLUMN IF NOT EXISTS stock_type          text,
  ADD COLUMN IF NOT EXISTS goods_receipt_date  text,
  ADD COLUMN IF NOT EXISTS sled                text,
  ADD COLUMN IF NOT EXISTS filename            text;

-- ── 2. Add v2 columns to cycle_counts ──────────────────────────
ALTER TABLE public.cycle_counts
  ADD COLUMN IF NOT EXISTS aisle        text,
  ADD COLUMN IF NOT EXISTS audit_mode   text DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS material     text,
  ADD COLUMN IF NOT EXISTS description  text,
  ADD COLUMN IF NOT EXISTS batch        text,
  ADD COLUMN IF NOT EXISTS unit         text,
  ADD COLUMN IF NOT EXISTS sled         text,
  ADD COLUMN IF NOT EXISTS sled_status  text;

-- ── 3. Training modules table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_modules (
  id          text        PRIMARY KEY,
  title       text        NOT NULL,
  category    text,
  type        text,
  body        text,
  mermaid     text,
  slides      jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.training_modules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "training_all" ON public.training_modules;
CREATE POLICY "training_all" ON public.training_modules
  FOR ALL USING (true) WITH CHECK (true);

-- ── 4. Assignments table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.assignments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text,
  value        text,
  description  text,
  assigned_by  text,
  assigned_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "assignments_all" ON public.assignments;
CREATE POLICY "assignments_all" ON public.assignments
  FOR ALL USING (true) WITH CHECK (true);

-- ── 5. Realtime on new tables ───────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.training_modules;
ALTER PUBLICATION supabase_realtime ADD TABLE public.assignments;

-- ── 6. Useful indexes ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cc_aisle      ON public.cycle_counts (session_id, aisle);
CREATE INDEX IF NOT EXISTS idx_cc_audit_mode ON public.cycle_counts (session_id, audit_mode);
CREATE INDEX IF NOT EXISTS idx_sap_material  ON public.sap_data     (session_id, material);
