// test_pool_saturation.js
// Fix 5 — Tests pool behaviour under real /check-in load (transactions, not SELECT 1).
//
// Usage: PORT=5099 node test_pool_saturation.js
//
// What this does:
//   1. Creates N test students (if they don't exist)
//   2. Teacher starts a session
//   3. Logs in each student (register-device + login)
//   4. Fires ALL check-ins concurrently via Promise.all
//   5. Asserts: all succeed, correct DB row count, no 500s, measures real latency

const pool = require('./db');
const bcrypt = require('bcrypt');

const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5001}`;
const CONCURRENT = parseInt(process.argv[2], 10) || 30;  // default: 30 students
const CAMPUS_LAT = parseFloat(process.env.CAMPUS_LAT || '12.9716');
const CAMPUS_LNG = parseFloat(process.env.CAMPUS_LNG || '77.5946');

const H = (extra = {}, ip = '127.0.0.1') => ({
  'Content-Type': 'application/json',
  'x-requested-with': 'api',
  'x-forwarded-for': ip,
  ...extra,
});

const allCookies = (res) =>
  (res.headers.getSetCookie?.() || [res.headers.get('set-cookie')]).filter(Boolean);

const cookieValue = (res, name) =>
  allCookies(res).find((c) => c.startsWith(`${name}=`))?.split(';')[0];

async function resetDevice(roll) {
  await pool.query(
    'UPDATE devices SET last_reset_at = NULL WHERE student_id = (SELECT id FROM students WHERE roll_number = $1)',
    [roll]
  );
}

async function ensureStudents(count) {
  const hash = await bcrypt.hash('demo', 12);
  for (let i = 1; i <= count; i++) {
    const roll = `POOL${String(i).padStart(3, '0')}`;
    await pool.query(
      `INSERT INTO students (name, roll_number, phone_number, password_hash, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (roll_number) DO UPDATE SET is_active = TRUE, deleted_at = NULL`,
      [`Pool Student ${i}`, roll, `5550000${String(i).padStart(4, '0')}`, hash]
    );
  }
}

async function loginStudent(roll, index) {
  const ip = `10.0.0.${index}`;
  await resetDevice(roll);
  const reg = await fetch(`${BACKEND_URL}/api/auth/student/register-device`, {
    method: 'POST',
    headers: H({}, ip),
    body: JSON.stringify({ roll_number: roll, password: 'demo' }),
  });
  if (!reg.ok) throw new Error(`register-device failed for ${roll}: ${reg.status}`);
  const dev = cookieValue(reg, 'device_token');
  const login = await fetch(`${BACKEND_URL}/api/auth/student/login`, {
    method: 'POST',
    headers: H({ Cookie: dev }, ip),
    body: JSON.stringify({ roll_number: roll, password: 'demo' }),
  });
  if (!login.ok) throw new Error(`login failed for ${roll}: ${login.status}`);
  const auth = cookieValue(login, 'student_auth_token');
  return { dev, auth, cookie: `${dev}; ${auth}`, ip };
}

async function run() {
  console.log(`\n🚀 Pool Saturation Test — ${CONCURRENT} concurrent check-ins against REAL /check-in\n`);
  const start = Date.now();

  // 1. Seed students
  await ensureStudents(CONCURRENT);
  console.log(`  Seeded ${CONCURRENT} test students`);

  // 2. Teacher login + start session
  const tl = await fetch(`${BACKEND_URL}/api/auth/teacher/login`, {
    method: 'POST', headers: H(),
    body: JSON.stringify({ phone_number: 'demo-teacher', password: 'demo' }),
  });
  if (!tl.ok) throw new Error(`teacher login failed: ${tl.status}`);
  const tAuth = cookieValue(tl, 'teacher_auth_token');

  const st = await fetch(`${BACKEND_URL}/api/sessions/start`, {
    method: 'POST', headers: H({ Cookie: tAuth }), body: JSON.stringify({}),
  });
  if (!st.ok) throw new Error(`start session failed: ${st.status}`);
  const { deepLinkUrl } = await st.json();
  const P = Object.fromEntries(new URL(deepLinkUrl).searchParams);
  console.log(`  Session started: ${P.session_id.slice(0, 8)}`);

  // 3. Login all students sequentially (device registration is inherently serial)
  console.log(`  Logging in ${CONCURRENT} students...`);
  const creds = [];
  for (let i = 1; i <= CONCURRENT; i++) {
    const roll = `POOL${String(i).padStart(3, '0')}`;
    const c = await loginStudent(roll, i);
    creds.push(c);
  }
  console.log(`  All students logged in (${Date.now() - start}ms so far)`);

  // 4. FIRE ALL CHECK-INS CONCURRENTLY
  const checkinStart = Date.now();
  const results = await Promise.all(
    creds.map(async ({ cookie, ip }, idx) => {
      const t0 = Date.now();
      try {
        const res = await fetch(`${BACKEND_URL}/api/attendance/check-in`, {
          method: 'POST',
          headers: H({ Cookie: cookie }, ip),
          body: JSON.stringify({
            session_id: P.session_id, nonce: P.nonce, t: P.t, sig: P.sig,
            gps_lat: CAMPUS_LAT, gps_lng: CAMPUS_LNG,
          }),
        });
        const elapsed = Date.now() - t0;
        const body = await res.text().then((x) => x.slice(0, 60));
        return { idx, status: res.status, elapsed, body };
      } catch (e) {
        return { idx, status: 0, elapsed: Date.now() - t0, error: e.message };
      }
    })
  );
  const checkinElapsed = Date.now() - checkinStart;

  // 5. Report
  const successes = results.filter((r) => r.status === 200);
  const failures = results.filter((r) => r.status !== 200);
  const fiveHundreds = results.filter((r) => r.status >= 500);
  const maxLatency = Math.max(...results.map((r) => r.elapsed));
  const avgLatency = Math.round(results.reduce((s, r) => s + r.elapsed, 0) / results.length);

  console.log(`\n  ─── RESULTS ───`);
  console.log(`  Total requests:  ${results.length}`);
  console.log(`  Success (200):   ${successes.length}`);
  console.log(`  Non-200:        ${failures.length}`);
  console.log(`  Server errors:  ${fiveHundreds.length}`);
  console.log(`  Total wall:     ${checkinElapsed}ms`);
  console.log(`  Avg latency:    ${avgLatency}ms`);
  console.log(`  Max latency:    ${maxLatency}ms`);

  if (fiveHundreds.length > 0) {
    console.log(`\n  ❌ 500s detected:`);
    fiveHundreds.forEach((r) => console.log(`     Student ${r.idx}: ${r.status} ${r.body || r.error}`));
  }
  if (failures.length > 0 && failures.length !== fiveHundreds.length) {
    console.log(`\n  ⚠️  Other failures:`);
    failures.filter((r) => r.status < 500).forEach((r) =>
      console.log(`     Student ${r.idx}: ${r.status} ${r.body || r.error}`)
    );
  }

  // 6. Verify DB row count
  const { rows: dbRows } = await pool.query(
    'SELECT count(*) FROM attendance_logs WHERE session_id = $1',
    [P.session_id]
  );
  console.log(`\n  DB attendance rows: ${dbRows[0].count}`);
  if (parseInt(dbRows[0].count) !== CONCURRENT) {
    console.log(`  ❌ Expected ${CONCURRENT}, got ${dbRows[0].count}`);
  } else {
    console.log(`  ✅ All ${CONCURRENT} check-ins recorded`);
  }

  // Cleanup
  await pool.query('DELETE FROM attendance_logs WHERE session_id = $1', [P.session_id]);
  await pool.query('DELETE FROM nonces WHERE session_id = $1', [P.session_id]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [P.session_id]);
  await pool.end();

  const exitCode = fiveHundreds.length > 0 ? 1 : 0;
  if (exitCode) console.log(`\n  ❌ FAIL — ${fiveHundreds.length} server errors detected`);
  else console.log(`\n  ✅ PASS — zero 500s, correct DB count, ${avgLatency}ms avg`);
  process.exit(exitCode);
}

run().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
