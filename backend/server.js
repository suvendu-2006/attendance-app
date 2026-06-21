const express = require('express');
const http = require('http');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const path = require('path');
const cookie = require('cookie');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = require('./db');
const authRoutes = require('./routes/auth');
const sessionRoutes = require('./routes/sessions');
const attendanceRoutes = require('./routes/attendance');
const overridesRoutes = require('./routes/overrides');

const app = express();

// (Fix 5) Trust proxy so req.ip reflects the real client behind nginx/Cloud Run
app.set('trust proxy', process.env.TRUST_PROXY !== undefined
  ? parseInt(process.env.TRUST_PROXY, 10) || process.env.TRUST_PROXY === 'true' ? 1 : 0
  : 1);

const REQUIRED_ENV = ['JWT_SECRET', 'DB_PASSWORD', 'CAMPUS_LAT', 'CAMPUS_LNG', 'HMAC_SECRET'];
REQUIRED_ENV.forEach((key) => {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required env var: ${key}`);
    process.exit(1);
  }
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", process.env.FRONTEND_URL].filter(Boolean),
    },
  },
}));

const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [process.env.FRONTEND_URL].filter(Boolean)
  : ['http://localhost:5173', 'http://localhost:5174'];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('CORS: origin not allowed'));
  },
  credentials: true,
};

// (Fix 3) Login limiter: 10 attempts per 15 minutes per IP.
// 500 was too generous — 11 wrong passwords should trigger 429.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

// Check-in limiter: 10 per minute per STUDENT (keyed by JWT identity, not IP).
// On campus NAT, all students share one public IP, so IP-keying blocks everyone after 5.
// jwt.decode (no verification) is safe here — the real auth middleware verifies later.
const checkInLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // validate: false suppresses ERR_ERL_KEY_GEN_IPV6 — our keyGenerator returns
  // identity strings ("student:<uuid>") for authenticated requests, not raw IPs.
  // req.ip is only the fallback for unauthenticated spam.
  validate: false,
  message: { error: 'Too many check-in attempts. Please wait a minute.' },
  keyGenerator: (req) => {
    // Try student cookie first, then Authorization header
    let token = null;
    if (req.cookies?.student_auth_token) {
      token = req.cookies.student_auth_token;
    } else if (req.cookies?.auth_token) {
      token = req.cookies.auth_token;
    } else {
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }
    if (token) {
      try {
        const decoded = jwt.decode(token);
        if (decoded?.id) return `student:${decoded.id}`;
      } catch {
        // Fall through to IP
      }
    }
    return req.ip; // Unauthenticated spam still throttled by IP
  },
});

// Device registration: keyed by student identity (same logic as check-in).
// register-device is a POST behind requireStudent, so the student JWT is available.
const registerDeviceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: { error: 'Too many device registration attempts. Please try again later.' },
  keyGenerator: (req) => {
    let token = null;
    if (req.cookies?.student_auth_token) {
      token = req.cookies.student_auth_token;
    } else if (req.cookies?.auth_token) {
      token = req.cookies.auth_token;
    } else {
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }
    if (token) {
      try {
        const decoded = jwt.decode(token);
        if (decoded?.id) return `device:${decoded.id}`;
      } catch {
        // Fall through to IP
      }
    }
    return req.ip;
  },
});

app.use(cors(corsOptions));
app.use(morgan('combined'));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Sanitize request body: strip null bytes that crash Postgres
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = req.body[key].replace(/\0/g, '');
      }
    }
  }
  next();
});

// CSRF Defense: Custom header required for state-changing requests
// Relies on CORS configuration blocking cross-origin requests from setting custom headers.
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    if (req.headers['x-requested-with'] !== 'api') {
      return res.status(403).json({ error: 'CSRF validation failed: missing x-requested-with header' });
    }
  }
  next();
});

app.use('/api/auth/student/login', authLimiter);
app.use('/api/auth/teacher/login', authLimiter);
app.use('/api/auth/student/register-device', registerDeviceLimiter);
app.use('/api/attendance/check-in', checkInLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/overrides', overridesRoutes);

const healthHandler = async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy' });
  } catch {
    res.status(503).json({ status: 'unhealthy', error: 'Database connection failed' });
  }
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// -------------------------------------------------------------------------
// Cleanup jobs — extract into reusable functions for both local + cron use
// -------------------------------------------------------------------------

async function expireSessions() {
  await pool.query(
    `WITH expired AS (
       SELECT id FROM sessions
       WHERE status = 'ACTIVE' AND expires_at < NOW()
       FOR UPDATE SKIP LOCKED
     )
     UPDATE sessions SET status = 'EXPIRED'
     WHERE id IN (SELECT id FROM expired)`
  );
}

async function cleanupNonces() {
  await pool.query('DELETE FROM nonces WHERE expires_at IS NOT NULL AND expires_at < NOW()');
}

async function cleanupRevokedTokens() {
  await pool.query('DELETE FROM revoked_tokens WHERE expires_at < NOW()');
}

// -------------------------------------------------------------------------
// Vercel Cron endpoint — called by vercel.json crons config
// Protected by CRON_SECRET to prevent external abuse.
// -------------------------------------------------------------------------

app.get('/api/cron/cleanup', async (req, res) => {
  // Vercel sets Authorization: Bearer <CRON_SECRET> on cron invocations.
  // Also accept a query param for manual testing.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers['authorization'];
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (headerToken !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const results = {};
  try {
    await expireSessions();
    results.sessions = 'ok';
  } catch (err) {
    results.sessions = err.message;
  }
  try {
    await cleanupNonces();
    results.nonces = 'ok';
  } catch (err) {
    results.nonces = err.message;
  }
  try {
    await cleanupRevokedTokens();
    results.revokedTokens = 'ok';
  } catch (err) {
    results.revokedTokens = err.message;
  }

  res.json({ status: 'done', results });
});

// -------------------------------------------------------------------------
// Local server: setInterval jobs + SIGTERM handling
// Vercel: export app as serverless handler
// -------------------------------------------------------------------------

const PORT = process.env.PORT || 5000;

if (process.env.VERCEL) {
  // Export the Express API for Vercel Serverless
  // setInterval jobs don't run here — use /api/cron/cleanup via Vercel Cron
  module.exports = app;
} else {
  // Standalone server for local development — run cleanup on intervals
  setInterval(async () => {
    try { await expireSessions(); }
    catch (err) { console.error('Session expiry sweep failed:', err); }
  }, 60 * 1000);

  setInterval(async () => {
    try { await cleanupNonces(); }
    catch (err) { console.error('Nonce cleanup failed:', err); }
  }, 10 * 60 * 1000);

  setInterval(async () => {
    try { await cleanupRevokedTokens(); }
    catch (err) { console.error('Revoked-token cleanup failed:', err); }
  }, 30 * 60 * 1000);

  const server = http.createServer(app);
  server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
      pool.end().then(() => {
        console.log('Database pool closed.');
        process.exit(0);
      });
    });
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  });
  process.on('SIGINT', () => process.emit('SIGTERM'));
}

