-- ============ REMAINING FIX MIGRATION ============
-- Run this AFTER migrations_fixes.sql.
-- Idempotent (IF NOT EXISTS everywhere).

-- 1. Token revocation table — replaces the in-memory blocklist.
-- Works across restarts and multi-instance deployments.
CREATE TABLE IF NOT EXISTS revoked_tokens (
  token_hash VARCHAR(64) PRIMARY KEY,        -- SHA-256 of the JWT (not the raw token)
  expires_at TIMESTAMPTZ NOT NULL            -- mirror of the JWT's exp claim; row auto-deleted after this
);

-- Auto-clean: delete rows whose JWT has already expired (no point keeping them)
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires
  ON revoked_tokens(expires_at);

-- 2. Soft-delete on students — prevents accidental history wipe.
-- ON DELETE CASCADE on attendance_logs currently wipes all records when a student is deleted.
-- This adds deleted_at; queries must filter WHERE deleted_at IS NULL.
ALTER TABLE students ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 3. Change attendance_logs FK from CASCADE to RESTRICT so a "deleted" student
-- doesn't lose their audit trail. After adding deleted_at, the app should use
-- soft-delete (SET deleted_at = NOW()) instead of hard DELETE.
-- This migration ALTERS the constraint. If your Postgres version supports ALTER CONSTRAINT:
DO $$
BEGIN
  -- Drop the existing CASCADE FK if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attendance_logs_student_id_fkey'
      AND conrelid = 'attendance_logs'::regclass
  ) THEN
    ALTER TABLE attendance_logs
      DROP CONSTRAINT attendance_logs_student_id_fkey,
      ADD CONSTRAINT attendance_logs_student_id_fkey
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- 4. Same for flags table — protect audit trail
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flags_student_id_fkey'
      AND conrelid = 'flags'::regclass
  ) THEN
    ALTER TABLE flags
      DROP CONSTRAINT flags_student_id_fkey,
      ADD CONSTRAINT flags_student_id_fkey
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- 5. Guest requests — also restrict (a deleted student's requests are part of the audit log)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'guest_requests_student_id_fkey'
      AND conrelid = 'guest_requests'::regclass
  ) THEN
    ALTER TABLE guest_requests
      DROP CONSTRAINT guest_requests_student_id_fkey,
      ADD CONSTRAINT guest_requests_student_id_fkey
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Note: devices table keeps CASCADE — if a student is soft-deleted, we DO want
-- to be able to hard-delete them eventually (after compliance hold period) and
-- have their device records cleaned up. The attendance_logs/flags/guest_requests
-- are the ones that must survive for grading audit.

-- 6. Cleanup job for revoked_tokens (run this periodically, e.g. from server.js)
-- DELETE FROM revoked_tokens WHERE expires_at < NOW();
