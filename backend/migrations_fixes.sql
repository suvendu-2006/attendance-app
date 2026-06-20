-- ============ ATTENDANCE PROJECT — CONSOLIDATED FIX MIGRATION ============
-- Idempotent. Run after schema.sql + migrations_phase0.sql.

-- (Issue 32) Baseline columns used by runtime code, in one place.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deep_link_url TEXT;
ALTER TABLE nonces   ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- (Issue 13) is_active already exists; confirm it has a safe default.
ALTER TABLE students ALTER COLUMN is_active SET DEFAULT TRUE;

-- (Issue 14) Enforce ONE device row per student.
-- First collapse any existing duplicates so the constraint can be added.
DELETE FROM devices d
  USING devices d2
  WHERE d.student_id = d2.student_id
    AND d.id < d2.id;   -- keep the newest (highest id) device row
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_student_id_key') THEN
    ALTER TABLE devices ADD CONSTRAINT devices_student_id_key UNIQUE (student_id);
  END IF;
END $$;

-- (Issues 1, 2, 27) Rebuild the nonces table into a per-student consumed-nonce table.
-- Old columns are reused; new ones give the model "issued vs used per student".
ALTER TABLE nonces ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE CASCADE;
ALTER TABLE nonces ADD COLUMN IF NOT EXISTS used_at     TIMESTAMPTZ;

-- A student may consume a given (session_id, nonce_value) exactly once.
-- The session-issued shared nonce still has its own unique row.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nonces_session_student_nonce_key') THEN
    ALTER TABLE nonces ADD CONSTRAINT nonces_session_student_nonce_key UNIQUE (session_id, student_id, nonce_value);
  END IF;
END $$;

-- (Issue 30) Add a CLOSE/EXPIRED status and an index to speed status queries.
CREATE INDEX IF NOT EXISTS idx_sessions_status_expires
  ON sessions(status, expires_at);

-- (Issue 32) Keep the indexes the runtime relies on.
CREATE INDEX IF NOT EXISTS idx_attendance_student_session
  ON attendance_logs(student_id, session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_session
  ON attendance_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_nonces_session_nonce
  ON nonces(session_id, nonce_value);
CREATE INDEX IF NOT EXISTS idx_devices_student
  ON devices(student_id);

-- (Issues 10, 11, 12, 15) admin flag on teachers
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- (Issue 25) support per-teacher campus coordinates
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS campus_lat DOUBLE PRECISION;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS campus_lng DOUBLE PRECISION;

-- Promote an existing teacher to admin (replace the id with your seed teacher's id):
-- UPDATE teachers SET is_admin = TRUE WHERE phone_number = '<your-phone>';
