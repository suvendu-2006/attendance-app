const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { requireTeacher, requireAdmin, requireAuth, revokeToken, extractToken, TOKEN_COOKIE_NAMES } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 12;
const DEVICE_COOKIE_NAME = 'device_token';

// -------------------------------------------------------------------------
// Cookie helpers — role-scoped cookie names prevent teacher/student collision
// -------------------------------------------------------------------------

function setDeviceCookie(res, token) {
  res.cookie(DEVICE_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
}

function setAuthCookie(res, token, role) {
  const cookieName = TOKEN_COOKIE_NAMES[role];  // 'teacher_auth_token' or 'student_auth_token'
  const maxAgeMs = role === 'teacher'
    ? 8 * 60 * 60 * 1000    // 8h teacher
    : 2 * 60 * 60 * 1000;   // 2h student
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: maxAgeMs,
  });
}

function clearAuthCookies(res) {
  // Clear BOTH role cookies on logout so no stale cookie survives
  for (const name of Object.values(TOKEN_COOKIE_NAMES)) {
    res.clearCookie(name, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });
  }
  // Also clear the legacy cookie name (if it exists from before the split)
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  });
}

function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// -------------------------------------------------------------------------
// Student login
// -------------------------------------------------------------------------

router.post('/student/login', async (req, res) => {
  try {
    const { roll_number, password } = req.body;
    if (!roll_number || !password) {
      return res.status(400).json({ error: 'Invalid or missing roll_number and password' });
    }

    const { rows } = await pool.query(
      `SELECT id, name, roll_number, password_hash, is_active, deleted_at
       FROM students WHERE roll_number = $1`,
      [roll_number]
    );
    const student = rows[0];

    if (!student || !(await bcrypt.compare(password, student.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (student.deleted_at) {
      return res.status(403).json({ error: 'ACCOUNT_DISABLED', message: 'Your account has been deleted. Contact your teacher.' });
    }
    if (!student.is_active) {
      return res.status(403).json({ error: 'ACCOUNT_DISABLED', message: 'Your account is inactive. Contact your teacher.' });
    }

    const providedCookie = req.cookies[DEVICE_COOKIE_NAME];
    const { rows: deviceRows } = await pool.query(
      'SELECT * FROM devices WHERE student_id = $1', [student.id]
    );
    const device = deviceRows[0];

    if (!device) {
      const newToken = crypto.randomBytes(32).toString('hex');
      await pool.query(
        `INSERT INTO devices (student_id, cookie_token, last_reset_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (student_id) DO UPDATE
           SET cookie_token = EXCLUDED.cookie_token, last_reset_at = EXCLUDED.last_reset_at`,
        [student.id, newToken, new Date()]
      );
      setDeviceCookie(res, newToken);
    } else {
      if (!providedCookie) {
        return res.status(403).json({
          error: 'DEVICE_MISMATCH',
          message: 'Unregistered device or cookies were cleared. Please register this device.',
        });
      }
      try {
        const a = Buffer.from(providedCookie);
        const b = Buffer.from(device.cookie_token);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          return res.status(403).json({
            error: 'DEVICE_MISMATCH',
            message: 'Unregistered device or cookies were cleared. Please register this device.',
          });
        }
      } catch {
        return res.status(403).json({
          error: 'DEVICE_MISMATCH',
          message: 'Unregistered device or cookies were cleared. Please register this device.',
        });
      }
    }

    const authToken = jwt.sign({ id: student.id, role: 'student' }, JWT_SECRET, { expiresIn: '2h' });
    setAuthCookie(res, authToken, 'student');
    res.json({ message: 'Login successful', student: { id: student.id, name: student.name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// -------------------------------------------------------------------------
// Register / change device
// -------------------------------------------------------------------------

router.post('/student/register-device', async (req, res) => {
  try {
    const { roll_number, password } = req.body;
    if (!roll_number || !password) {
      return res.status(400).json({ error: 'Invalid or missing roll_number and password' });
    }

    const { rows } = await pool.query(
      `SELECT id, password_hash, is_active FROM students WHERE roll_number = $1`,
      [roll_number]
    );
    const student = rows[0];
    if (!student || !(await bcrypt.compare(password, student.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!student.is_active) {
      return res.status(403).json({ error: 'ACCOUNT_DISABLED', message: 'Your account is inactive.' });
    }

    const { rows: deviceRows } = await pool.query('SELECT * FROM devices WHERE student_id = $1', [student.id]);
    const device = deviceRows[0];

    if (device && device.last_reset_at) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      if (new Date(device.last_reset_at) > thirtyDaysAgo) {
        return res.status(403).json({
          error: 'COOLDOWN_ACTIVE',
          message: 'Device can only be changed once every 30 days. Ask your teacher to reset the limit.',
        });
      }
    }

    const newToken = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO devices (student_id, cookie_token, last_reset_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (student_id) DO UPDATE
         SET cookie_token = EXCLUDED.cookie_token, last_reset_at = EXCLUDED.last_reset_at`,
      [student.id, newToken, new Date()]
    );

    setDeviceCookie(res, newToken);
    res.json({ message: 'New device registered successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// -------------------------------------------------------------------------
// Teacher login
// -------------------------------------------------------------------------

router.post('/teacher/login', async (req, res) => {
  try {
    const { phone_number, password } = req.body;
    if (!phone_number || !password) {
      return res.status(400).json({ error: 'Invalid or missing phone_number and password' });
    }
    const { rows } = await pool.query(
      `SELECT id, name, phone_number, password_hash FROM teachers WHERE phone_number = $1`,
      [phone_number]
    );
    const teacher = rows[0];
    if (!teacher || !(await bcrypt.compare(password, teacher.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const authToken = jwt.sign({ id: teacher.id, role: 'teacher' }, JWT_SECRET, { expiresIn: '8h' });
    setAuthCookie(res, authToken, 'teacher');
    res.json({ message: 'Login successful', teacher: { id: teacher.id, name: teacher.name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// -------------------------------------------------------------------------
// Admin endpoints
// -------------------------------------------------------------------------

router.post('/admin/register-teacher', requireTeacher, requireAdmin, async (req, res) => {
  try {
    const { name, phone_number, password, is_admin } = req.body;
    if (!name || !phone_number || !password) {
      return res.status(400).json({ error: 'name, phone_number and password are required' });
    }
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows } = await pool.query(
      `INSERT INTO teachers (name, phone_number, password_hash, is_admin)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (phone_number) DO NOTHING
       RETURNING id, name, phone_number`,
      [name, phone_number, hash, Boolean(is_admin)]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Teacher with that phone number already exists' });
    res.json({ message: 'Teacher created', teacher: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin/register-student', requireTeacher, requireAdmin, async (req, res) => {
  try {
    const { name, roll_number, phone_number, password } = req.body;
    if (!name || !roll_number || !phone_number || !password) {
      return res.status(400).json({ error: 'name, roll_number, phone_number and password are required' });
    }
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows } = await pool.query(
      `INSERT INTO students (name, roll_number, phone_number, password_hash, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (roll_number) DO NOTHING
       RETURNING id, name, roll_number`,
      [name, roll_number, phone_number, hash]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Student with that roll number already exists' });
    res.json({ message: 'Student created', student: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin/reset-student-password', requireTeacher, requireAdmin, async (req, res) => {
  try {
    const { student_id, new_password } = req.body;
    if (!isUuid(student_id) || !new_password) {
      return res.status(400).json({ error: 'Valid student_id and new_password are required' });
    }
    const hash = await bcrypt.hash(new_password, SALT_ROUNDS);
    const { rowCount } = await pool.query(
      `UPDATE students SET password_hash = $1 WHERE id = $2`, [hash, student_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Student not found' });
    res.json({ message: 'Password reset successful.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// -------------------------------------------------------------------------
// Soft-delete student (admin) — sets deleted_at instead of hard DELETE
// -------------------------------------------------------------------------

router.get('/admin/students', requireTeacher, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, roll_number, phone_number FROM students WHERE deleted_at IS NULL ORDER BY roll_number ASC'
    );
    res.json({ students: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin/soft-delete-student', requireTeacher, requireAdmin, async (req, res) => {
  try {
    const { student_id } = req.body;
    if (!isUuid(student_id)) return res.status(400).json({ error: 'Invalid student_id' });

    const { rowCount } = await pool.query(
      'UPDATE students SET is_active = FALSE, deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [student_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Student not found or already deleted' });

    console.log(`[AUDIT] soft-delete: actor=${req.user.id} target=${student_id} at=${new Date().toISOString()}`);
    res.json({ message: 'Student soft-deleted. Attendance records preserved.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/teacher/reset-device-limit', requireTeacher, requireAdmin, async (req, res) => {
  try {
    const { student_id } = req.body;
    if (!isUuid(student_id)) return res.status(400).json({ error: 'Invalid student_id' });

    const { rowCount } = await pool.query(
      `UPDATE devices SET last_reset_at = NULL WHERE student_id = $1`, [student_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'No device record for that student' });

    console.log(`[AUDIT] device-limit reset: actor=${req.user.id} target=${student_id} at=${new Date().toISOString()}`);
    res.json({ message: 'Device limit reset successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// -------------------------------------------------------------------------
// Logout — clears role-specific cookies, revokes token in DB
// -------------------------------------------------------------------------

router.post('/logout', (req, res) => {
  // Revoke the token server-side (DB-backed — survives restart, shared across instances)
  const token = extractToken(req);  // try all cookie names + header
  if (token) {
    // Decode just enough to get the exp claim (don't verify — expired tokens are harmless to store)
    try {
      const decoded = jwt.decode(token);
      if (decoded && decoded.exp) {
        revokeToken(token, decoded.exp);
      }
    } catch {
      // Token is malformed — can't revoke, but clearing the cookie is enough
    }
  }

  clearAuthCookies(res);
  res.json({ message: 'Logged out successfully' });
});

// -------------------------------------------------------------------------
// /me — session validation endpoint
// -------------------------------------------------------------------------

router.get('/me', requireAuth, async (req, res) => {
  try {
    const { id, role } = req.user;
    if (role === 'student') {
      const { rows } = await pool.query(
        'SELECT id, name, roll_number FROM students WHERE id = $1 AND deleted_at IS NULL', [id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'User not found' });
      return res.json({ authenticated: true, user: { ...rows[0], role } });
    } else if (role === 'teacher') {
      const { rows } = await pool.query(
        'SELECT id, name, phone_number, is_admin FROM teachers WHERE id = $1', [id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'User not found' });
      return res.json({ authenticated: true, user: { ...rows[0], role } });
    }
  } catch (err) {
    console.error('Error fetching /me:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
