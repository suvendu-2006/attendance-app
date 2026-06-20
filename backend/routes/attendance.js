const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { requireStudent } = require('../middleware/auth');
const deviceMiddleware = require('../middleware/device');

const router = express.Router();
const HMAC_SECRET = process.env.HMAC_SECRET;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function verifyHmac(params, receivedSig) {
  try {
    if (!/^[0-9a-f]+$/i.test(receivedSig)) return false;
    const signedString = `${params.session_id}:${params.nonce}:${params.t}`;
    const expectedSig = crypto.createHmac('sha256', HMAC_SECRET).update(signedString).digest('hex');
    const receivedBuffer = Buffer.from(receivedSig, 'hex');
    const expectedBuffer = Buffer.from(expectedSig, 'hex');
    if (receivedBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

function verifyTimestamp(t) {
  const linkTime = parseInt(t, 10) * 1000;
  if (!isFinite(linkTime) || linkTime <= 0) return false;
  const now = Date.now();
  // Reject timestamps more than 30s in the future (clock skew tolerance)
  if (linkTime > now + 30 * 1000) return false;
  return now - linkTime < 30 * 60 * 1000;
}

async function logFlag(student_id, session_id, reasonCode, lat, lng, ip) {
  try {
    await pool.query(
      `INSERT INTO flags (student_id, session_id, reason_code, gps_lat, gps_lng, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [student_id, session_id, reasonCode, lat || 0, lng || 0, ip]
    );
  } catch (err) {
    console.error('Best-effort logFlag failed:', err.message);
  }
}

// (Issue 24) Anomaly flagging — best-effort, defence in depth. Never throws.
async function maybeFlagAnomaly(studentId, sessionId, lat, lng, ip) {
  try {
    // 1) Did this student mark a different session from a very different place recently?
    const { rows } = await pool.query(
      `SELECT gps_lat, gps_lng, created_at FROM attendance_logs
        WHERE student_id = $1 AND created_at > NOW() - INTERVAL '1 hour'
        ORDER BY created_at DESC LIMIT 1`,
      [studentId]
    );
    if (rows[0] && rows[0].gps_lat != null) {
      const dist = haversineDistance(lat, lng, rows[0].gps_lat, rows[0].gps_lng);
      const elapsedSec = (Date.now() - new Date(rows[0].created_at).getTime()) / 1000;
      // Physically impossible speed between two check-ins (> 200 km/h).
      if (elapsedSec > 5 && (dist / elapsedSec) > 55) {
        await logFlag(studentId, sessionId, 'VELOCITY_ANOMALY', lat, lng, ip);
      }
    }
  } catch (e) {
    console.error('Anomaly check failed:', e.message);
  }
}

router.post('/check-in', requireStudent, deviceMiddleware, async (req, res) => {
  const { session_id, nonce, t, sig, gps_lat, gps_lng } = req.body;
  const student_id = req.user.id;
  const ipAddress = req.ip || req.headers['x-forwarded-for'];

  try {
    if (!session_id || !nonce || !t || !sig || gps_lat === undefined || gps_lng === undefined) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    if (!UUID_REGEX.test(session_id)) {
      return res.status(400).json({ error: 'Invalid session_id format' });
    }
    const lat = parseFloat(gps_lat);
    const lng = parseFloat(gps_lng);
    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Invalid GPS coordinates' });
    }

    if (!verifyHmac({ session_id, nonce, t }, sig)) {
      await logFlag(student_id, session_id, 'SIGNATURE_INVALID', lat, lng, ipAddress);
      return res.status(403).json({ error: 'Invalid or tampered link.' });
    }
    if (!verifyTimestamp(t)) {
      await logFlag(student_id, session_id, 'WINDOW_CLOSED', lat, lng, ipAddress);
      return res.status(403).json({ error: 'Link has expired.' });
    }

    const { rows: sessionRows } = await pool.query(
      `SELECT s.*, t.campus_lat, t.campus_lng FROM sessions s JOIN teachers t ON s.teacher_id = t.id WHERE s.id = $1 AND s.status = 'ACTIVE' AND s.expires_at > NOW()`,
      [session_id]
    );
    const session = sessionRows[0];
    if (!session) {
      await logFlag(student_id, session_id, 'SESSION_INACTIVE', lat, lng, ipAddress);
      return res.status(403).json({ error: 'Session is no longer active.' });
    }

    const { rows: studentRows } = await pool.query(
      `SELECT is_active, deleted_at FROM students WHERE id = $1`,
      [student_id]
    );
    if (!studentRows[0] || !studentRows[0].is_active || studentRows[0].deleted_at) {
      await logFlag(student_id, session_id, 'ACCOUNT_INACTIVE', lat, lng, ipAddress);
      return res.status(403).json({ error: 'Account is not active.' });
    }

    const { rows: issuedRows } = await pool.query(
      `SELECT id FROM nonces WHERE session_id = $1 AND nonce_value = $2`,
      [session_id, nonce]
    );
    if (issuedRows.length === 0) {
      await logFlag(student_id, session_id, 'NONCE_UNKNOWN', lat, lng, ipAddress);
      return res.status(403).json({ error: 'Invalid link.' });
    }

    const CAMPUS_LAT = session.campus_lat != null ? parseFloat(session.campus_lat) : parseFloat(process.env.CAMPUS_LAT);
    const CAMPUS_LNG = session.campus_lng != null ? parseFloat(session.campus_lng) : parseFloat(process.env.CAMPUS_LNG);
    const MAX_DIST = 300;
    const dist = haversineDistance(lat, lng, CAMPUS_LAT, CAMPUS_LNG);
    if (dist > MAX_DIST) {
      await logFlag(student_id, session_id, 'GPS_FAIL', lat, lng, ipAddress);
      return res.status(403).json({ error: 'Too far from campus.' });
    }

    const client = await pool.getClient();
    try {
      await client.query('BEGIN');

      const consume = await client.query(
        `INSERT INTO nonces (session_id, student_id, nonce_value, expires_at, used_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '2 minutes', NOW())
         ON CONFLICT (session_id, student_id, nonce_value) DO NOTHING`,
        [session_id, student_id, nonce]
      );

      if (consume.rowCount === 0) {
        await client.query('ROLLBACK');
        const { rows: existing } = await pool.query(
          `SELECT id FROM attendance_logs WHERE student_id = $1 AND session_id = $2`,
          [student_id, session_id]
        );
        if (existing.length > 0) return res.json({ message: 'Attendance already recorded.' });
        await logFlag(student_id, session_id, 'NONCE_REPLAY', lat, lng, ipAddress);
        return res.status(409).json({ error: 'This link has already been used by you.' });
      }

      const insert = await client.query(
        `INSERT INTO attendance_logs
           (student_id, session_id, status, gps_lat, gps_lng, verification_method)
         VALUES ($1, $2, 'PRESENT', $3, $4, 'DEEP_LINK')
         ON CONFLICT (student_id, session_id) DO NOTHING`,
        [student_id, session_id, lat, lng]
      );

      await client.query('COMMIT');

      if (insert.rowCount === 0) {
        return res.json({ message: 'Attendance already recorded.' });
      }
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }

    if (req.io) {
      try {
        const { rows: namedRows } = await pool.query('SELECT name FROM students WHERE id = $1', [student_id]);
        const name = namedRows[0]?.name || 'Unknown Student';
        req.io.to(`teacher_${session.teacher_id}`).emit('attendance_recorded', { student_id, name });
      } catch (e) {
        console.error('Realtime notify failed:', e.message);
      }
    }

    await maybeFlagAnomaly(student_id, session_id, lat, lng, ipAddress);
    res.json({ message: 'Attendance marked successfully!', status: 'PRESENT' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
