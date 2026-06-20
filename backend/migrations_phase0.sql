-- From previous plan: store deep link at creation time
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deep_link_url TEXT;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_attendance_student_session
  ON attendance_logs(student_id, session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_session
  ON attendance_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_nonces_session_nonce
  ON nonces(session_id, nonce_value);
CREATE INDEX IF NOT EXISTS idx_devices_student
  ON devices(student_id);

-- Nonce expiry support (add expiry column if missing)
ALTER TABLE nonces ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Add unique constraints (for existing databases)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_student_session') THEN
    ALTER TABLE attendance_logs ADD CONSTRAINT unique_student_session UNIQUE (student_id, session_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_session_nonce') THEN
    ALTER TABLE nonces ADD CONSTRAINT unique_session_nonce UNIQUE (session_id, nonce_value);
  END IF;
END $$;
