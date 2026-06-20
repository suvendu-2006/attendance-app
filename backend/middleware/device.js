const pool = require('../db');

async function deviceMiddleware(req, res, next) {
  const deviceToken = req.cookies?.device_token; // HTTP-only cookie

  if (!deviceToken) {
    return res.status(401).json({ error: 'Device not registered. Please log in from your registered device.' });
  }

  const studentId = req.user.id; // set by requireStudent middleware

  try {
    const result = await pool.query(
      'SELECT id FROM devices WHERE student_id = $1 AND cookie_token = $2',
      [studentId, deviceToken]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Unrecognized device. Access denied.' });
    }

    next();
  } catch (err) {
    console.error('Device middleware error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = deviceMiddleware;
