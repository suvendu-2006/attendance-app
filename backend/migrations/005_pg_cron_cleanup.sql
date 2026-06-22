-- Enable pg_cron extension if not already enabled (Supabase supports this)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule session expiry every minute
SELECT cron.schedule('expire-sessions-minutely', '* * * * *', $$
  UPDATE sessions SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND expires_at < NOW();
$$);

-- Schedule nonce cleanup every 10 minutes
SELECT cron.schedule('cleanup-nonces-10min', '*/10 * * * *', $$
  DELETE FROM nonces WHERE expires_at IS NOT NULL AND expires_at < NOW();
$$);

-- Schedule revoked token cleanup every 30 minutes
SELECT cron.schedule('cleanup-revoked-30min', '*/30 * * * *', $$
  DELETE FROM revoked_tokens WHERE expires_at < NOW();
$$);
