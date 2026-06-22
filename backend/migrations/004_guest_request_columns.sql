-- Migration 004: Add GPS and reason columns to guest_requests
-- Required for audit fix #10 (guest mode GPS logging + friction)

ALTER TABLE guest_requests ADD COLUMN IF NOT EXISTS gps_lat DOUBLE PRECISION;
ALTER TABLE guest_requests ADD COLUMN IF NOT EXISTS gps_lng DOUBLE PRECISION;
ALTER TABLE guest_requests ADD COLUMN IF NOT EXISTS reason TEXT;
