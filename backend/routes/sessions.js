const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { requireTeacher } = require('../middleware/auth');

const router = express.Router();
const HMAC_SECRET = process.env.HMAC_SECRET;

router.post('/start', requireTeacher, async (req, res) => {
  const client = await pool.getClient();
  try {
    const teacherId = req.user.id;
    const now = Date.now();
    const sessionIdDuration = 90 * 1000;

    await client.query('BEGIN');

    const { rows: sessionRows } = await client.query(
      `INSERT INTO sessions (teacher_id, status, started_at, expires_at)
       VALUES ($1, 'ACTIVE', $2, $3) RETURNING *`,
      [teacherId, new Date(now), new Date(now + sessionIdDuration)]
    );
    const session = sessionRows[0];

    const nonceValue = crypto.randomBytes(16).toString('hex');
    await client.query(
      `INSERT INTO nonces (session_id, nonce_value)
       VALUES ($1, $2)`,
      [session.id, nonceValue]
    );

    const timestamp = Math.floor(now / 1000).toString();
    const payload = `${session.id}:${nonceValue}:${timestamp}`;
    const signature = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const deepLinkUrl =
      `${baseUrl}/check-in?session_id=${session.id}&nonce=${nonceValue}` +
      `&t=${timestamp}&sig=${signature}`;

    await client.query('UPDATE sessions SET deep_link_url = $1 WHERE id = $2', [deepLinkUrl, session.id]);
    session.deep_link_url = deepLinkUrl;

    await client.query('COMMIT');


    res.json({ message: 'Session started successfully', session, deepLinkUrl });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.post('/extend', requireTeacher, async (req, res) => {
  try {
    const { session_id } = req.body;
    const { rows } = await pool.query(
      `SELECT * FROM sessions WHERE id = $1 FOR UPDATE`,
      [session_id]
    );
    const session = rows[0];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

    if (session.status !== 'ACTIVE' || new Date(session.expires_at) <= new Date()) {
      return res.status(400).json({ error: 'Session is no longer active and cannot be extended' });
    }

    const newExpiresAt = new Date(new Date(session.expires_at).getTime() + 30 * 1000);
    await pool.query('UPDATE sessions SET expires_at = $1 WHERE id = $2', [newExpiresAt, session_id]);


    res.json({ message: 'Session extended by 30 seconds', newExpiresAt: newExpiresAt.toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/active', requireTeacher, async (req, res) => {
  try {
    const { rows: sessionRows } = await pool.query(
      `SELECT * FROM sessions
       WHERE teacher_id = $1 AND expires_at > NOW() AND status = 'ACTIVE'
       ORDER BY started_at DESC LIMIT 1`,
      [req.user.id]
    );
    const session = sessionRows[0];
    if (!session) return res.json({ active: false });

    const { rows: studentRows } = await pool.query(
      `SELECT s.id, s.name FROM attendance_logs a
       JOIN students s ON a.student_id = s.id
       WHERE a.session_id = $1 ORDER BY a.created_at ASC`,
      [session.id]
    );

    return res.json({
      active: true,
      session: {
        id: session.id,
        teacher_id: session.teacher_id,
        expires_at: session.expires_at,
        deep_link_url: session.deep_link_url,
      },
      checkedInStudents: studentRows,
    });
  } catch (err) {
    console.error('Error fetching active session:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
