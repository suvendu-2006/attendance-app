const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');

// Token hash cache: avoids a DB round-trip on every request for already-checked tokens.
// Expires entries after their JWT would have expired anyway.
const tokenCache = new Map();

const TOKEN_COOKIE_NAMES = {
  teacher: 'teacher_auth_token',
  student: 'student_auth_token',
};

// -------------------------------------------------------------------------
// Token revocation — backed by the revoked_tokens DB table.
// Works across restarts and multi-instance (PM2 cluster, load-balanced).
// -------------------------------------------------------------------------

async function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function isTokenRevoked(token) {
  // 1. Check in-memory cache first (hot path, no DB hit)
  if (tokenCache.has(token)) return true;

  // 2. Check DB (survives restart, shared across instances)
  const tokenHash = await hashToken(token);
  try {
    const { rows } = await pool.query(
      'SELECT 1 FROM revoked_tokens WHERE token_hash = $1', [tokenHash]
    );
    if (rows.length > 0) {
      tokenCache.set(token, true);            // cache for future requests
      return true;
    }
  } catch (err) {
    // If the DB query fails, FAIL OPEN — don't block every request.
    // Log but allow the request through; the JWT's own expiry is the real bound.
    console.error('Token revocation check failed (failing open):', err.message);
  }
  return false;
}

async function revokeToken(token, decodedExp) {
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(decodedExp * 1000);      // JWT exp is in seconds

  tokenCache.set(token, true);

  try {
    await pool.query(
      'INSERT INTO revoked_tokens (token_hash, expires_at) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [tokenHash, expiresAt]
    );
  } catch (err) {
    // Log but don't throw — the in-memory cache is the primary guard.
    console.error('Failed to persist token revocation:', err.message);
  }

  // Clean cache entry when the JWT expires (derived from decoded exp, not hardcoded)
  const ttlMs = expiresAt.getTime() - Date.now() + 5000; // 5s grace
  setTimeout(() => tokenCache.delete(token), Math.max(ttlMs, 0));
}

// -------------------------------------------------------------------------
// Token extraction — reads the role-specific cookie, falls back to header.
// -------------------------------------------------------------------------

function extractToken(req, role) {
  // Try role-specific cookie first
  const cookieName = role ? TOKEN_COOKIE_NAMES[role] : null;
  if (cookieName && req.cookies && req.cookies[cookieName]) {
    return req.cookies[cookieName];
  }
  // Fallback: generic auth_token (legacy support — e.g. during migration)
  if (req.cookies && req.cookies.auth_token) {
    return req.cookies.auth_token;
  }
  // Fallback: Authorization header (API clients, tests, socket.io)
  const authHeader = req.headers['authorization'];
  return authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

// -------------------------------------------------------------------------
// Decode + verify — checks revocation, role, expiry.
// -------------------------------------------------------------------------

async function decode(req, res, role) {
  const token = extractToken(req, role);
  if (!token) return { error: res.status(401).json({ error: 'No token provided' }) };
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    // Check revocation (DB-backed + in-memory cache)
    if (await isTokenRevoked(token)) {
      return { error: res.status(401).json({ error: 'Token has been revoked' }) };
    }

    if (role && decoded.role !== role) {
      return { error: res.status(403).json({ error: `${role} access required` }) };
    }
    return { decoded };
  } catch (err) {
    if (err.name === 'TokenExpiredError') return { error: res.status(401).json({ error: 'Token expired' }) };
    return { error: res.status(401).json({ error: 'Invalid token' }) };
  }
}

// -------------------------------------------------------------------------
// Middleware factories
// -------------------------------------------------------------------------

function requireTeacher(req, res, next) {
  decode(req, res, 'teacher').then(({ decoded, error }) => {
    if (error) return error;
    req.user = decoded;
    next();
  });
}

function requireStudent(req, res, next) {
  decode(req, res, 'student').then(({ decoded, error }) => {
    if (error) return error;
    req.user = decoded;
    next();
  });
}

function requireAuth(req, res, next) {
  decode(req, res, null).then(({ decoded, error }) => {
    if (error) return error;
    req.user = decoded;
    next();
  });
}

async function requireAdmin(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT is_admin FROM teachers WHERE id = $1', [req.user.id]);
    if (!rows[0] || !rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (err) {
    console.error('requireAdmin error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  requireTeacher,
  requireStudent,
  requireAdmin,
  requireAuth,
  revokeToken,
  extractToken,
  TOKEN_COOKIE_NAMES,
};
