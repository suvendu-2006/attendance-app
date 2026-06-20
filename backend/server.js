const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
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
const server = http.createServer(app);

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
      connectSrc: ["'self'", process.env.FRONTEND_URL, "ws:", "wss:"].filter(Boolean),
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

// Check-in limiter: 5 per minute per IP (student clicking retry frantically).
// For a real 30-student stampede, each gets 5 — more than enough for 1 real + 4 retries.
const checkInLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many check-in attempts. Please wait a minute.' },
});

// Device registration: same as login (credential-gated)
const registerDeviceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many device registration attempts. Please try again later.' },
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

const io = new Server(server, { cors: corsOptions });

app.use((req, res, next) => {
  req.io = io;
  next();
});

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

io.use((socket, next) => {
  let token = socket.handshake.auth?.token;
  if (!token && socket.handshake.headers.cookie) {
    const cookies = cookie.parse(socket.handshake.headers.cookie);
    // Check role-specific cookie names (Fix 2), then legacy auth_token
    token = cookies.teacher_auth_token || cookies.student_auth_token || cookies.auth_token;
  }
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    socket.user = decoded;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join_teacher_room', (clientTeacherId) => {
    if (socket.user?.role !== 'teacher') return;
    if (String(clientTeacherId) === String(socket.user.id)) {
      socket.join(`teacher_${socket.user.id}`);
      console.log(`Teacher joined room: teacher_${socket.user.id}`);
    } else {
      console.warn(`Refused cross-teacher room join by ${socket.user.id} -> ${clientTeacherId}`);
    }
  });

  socket.on('disconnect', () => console.log('User disconnected:', socket.id));
});

setInterval(async () => {
  try {
    // Use a CTE with FOR UPDATE SKIP LOCKED to avoid clobbering concurrent extend operations
    await pool.query(
      `WITH expired AS (
         SELECT id FROM sessions
         WHERE status = 'ACTIVE' AND expires_at < NOW()
         FOR UPDATE SKIP LOCKED
       )
       UPDATE sessions SET status = 'EXPIRED'
       WHERE id IN (SELECT id FROM expired)`
    );
  } catch (err) {
    console.error('Session expiry sweep failed:', err);
  }
}, 60 * 1000);

setInterval(async () => {
  try {
    await pool.query('DELETE FROM nonces WHERE expires_at IS NOT NULL AND expires_at < NOW()');
  } catch (err) {
    console.error('Nonce cleanup failed:', err);
  }
}, 10 * 60 * 1000);

// Clean up expired revoked tokens (they're useless once the JWT itself expired)
setInterval(async () => {
  try {
    await pool.query('DELETE FROM revoked_tokens WHERE expires_at < NOW()');
  } catch (err) {
    console.error('Revoked-token cleanup failed:', err);
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 5000;
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
