-- Fix: Drop the legacy 2-column unique constraints on nonces.
-- The correct constraint is nonces_session_student_nonce_key (session_id, student_id, nonce_value).
-- The old 2-column constraints prevented per-student nonce consumption, causing 500 errors on every check-in.
ALTER TABLE nonces DROP CONSTRAINT IF EXISTS nonces_session_id_nonce_value_key;
ALTER TABLE nonces DROP CONSTRAINT IF EXISTS unique_session_nonce;
