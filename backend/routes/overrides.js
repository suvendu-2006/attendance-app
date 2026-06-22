const express = require('express');
const pool = require('../db');
const { requireTeacher, requireStudent } = require('../middleware/auth');

const router = express.Router();

async function notifyAttendance(req, teacherId, studentId) {
  // Socket removed for Vercel
}

router.post('/guest-request', requireStudent, async (req, res) => {
  try {
    const { session_id, gps_lat, gps_lng, reason } = req.body;
    const student_id = req.user.id;
    if (!session_id || typeof session_id !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing session_id' });
    }

    const { rows: sessionRows } = await pool.query('SELECT teacher_id, status, expires_at FROM sessions WHERE id = $1', [session_id]);
    const session = sessionRows[0];
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Reject guest requests for expired/inactive sessions
    if (session.status !== 'ACTIVE' || new Date(session.expires_at) < new Date()) {
      return res.status(403).json({ error: 'Session is no longer active. Guest requests cannot be submitted.' });
    }

    // Rate limit: max 3 guest requests per student per week
    const { rows: recentRequests } = await pool.query(
      `SELECT COUNT(*) as cnt FROM guest_requests WHERE student_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
      [student_id]
    );
    if (parseInt(recentRequests[0].cnt) >= 3) {
      return res.status(429).json({ error: 'Maximum 3 guest requests per week. Contact your teacher directly.' });
    }

    // Parse optional GPS coordinates
    const lat = gps_lat != null ? parseFloat(gps_lat) : null;
    const lng = gps_lng != null ? parseFloat(gps_lng) : null;

    await pool.query(
      `INSERT INTO guest_requests (student_id, session_id, status, gps_lat, gps_lng, reason)
       VALUES ($1, $2, 'PENDING', $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [student_id, session_id, lat, lng, reason || null]
    );

    res.json({ message: 'Guest request sent to teacher.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/approve-guest', requireTeacher, async (req, res) => {
  const client = await pool.getClient();
  try {
    const { request_id, confirm_name } = req.body;
    if (!request_id || typeof request_id !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing request_id' });
    }
    // Friction: teacher must type the student's name to confirm
    if (!confirm_name || typeof confirm_name !== 'string' || confirm_name.trim().length === 0) {
      return res.status(400).json({ error: 'You must type the student\'s name to confirm approval (confirm_name field).' });
    }

    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT gr.student_id, gr.session_id, gr.status, s.teacher_id
         FROM guest_requests gr
         JOIN sessions s ON s.id = gr.session_id
        WHERE gr.id = $1
        FOR UPDATE`,
      [request_id]
    );
    const reqRow = rows[0];
    if (!reqRow) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Request not found' }); }

    if (reqRow.teacher_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Not authorized to approve this request' });
    }
    if (reqRow.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.json({ message: 'Request already processed.' });
    }

    // Verify the typed name matches the actual student name (case-insensitive)
    const { rows: studentRows } = await client.query('SELECT name FROM students WHERE id = $1', [reqRow.student_id]);
    const studentName = studentRows[0]?.name || '';
    if (studentName.toLowerCase().trim() !== confirm_name.toLowerCase().trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Student name does not match. Please type the correct name.' });
    }

    await client.query(
      `UPDATE guest_requests SET status = 'APPROVED', approved_by = $1 WHERE id = $2`,
      [req.user.id, request_id]
    );

    const insert = await client.query(
      `INSERT INTO attendance_logs (student_id, session_id, status, verification_method)
       VALUES ($1, $2, 'PRESENT', 'GUEST_MODE')
       ON CONFLICT (student_id, session_id) DO NOTHING`,
      [reqRow.student_id, reqRow.session_id]
    );

    await client.query('COMMIT');

    if (insert.rowCount > 0) {
      await notifyAttendance(req, reqRow.teacher_id, reqRow.student_id);
    }
    res.json({ message: 'Guest approved and attendance marked.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.post('/manual-override', requireTeacher, async (req, res) => {
  const client = await pool.getClient();
  try {
    const { student_id, session_id } = req.body;
    if (!student_id || !session_id) {
      return res.status(400).json({ error: 'student_id and session_id are required' });
    }

    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM sessions WHERE id = $1 AND teacher_id = $2 FOR UPDATE`,
      [session_id, req.user.id]
    );
    const session = rows[0];
    if (!session) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Session not found or not owned' }); }

    // Validate student exists before attempting INSERT to prevent FK violation
    const { rows: studentCheck } = await client.query('SELECT id FROM students WHERE id = $1', [student_id]);
    if (studentCheck.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found' });
    }

    const now = new Date();
    const expiresAt = new Date(session.expires_at);
    const windowEnd = new Date(expiresAt.getTime() + 30 * 60 * 1000); // 30-minute override window
    if (now < expiresAt) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Manual override is available only after the session ends.' });
    }
    if (now > windowEnd) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Manual override window (30 minutes) has closed.' });
    }

    const insert = await client.query(
      `INSERT INTO attendance_logs (student_id, session_id, status, verification_method)
       VALUES ($1, $2, 'PRESENT', 'MANUAL_OVERRIDE')
       ON CONFLICT (student_id, session_id) DO NOTHING`,
      [student_id, session_id]
    );

    await client.query('COMMIT');

    if (insert.rowCount > 0) await notifyAttendance(req, session.teacher_id, student_id);
    res.json({ message: 'Attendance manually overridden successfully.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
