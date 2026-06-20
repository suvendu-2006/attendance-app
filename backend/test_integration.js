const crypto = require('crypto');
const pool = require('./db');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5001';

async function runTests() {
  console.log('🚀 Integration tests (real endpoints)...\n');
  let sAuthCookie = '';
  let tAuthCookie = '';
  let deviceCookie = '';

  try {
    const tLogin = await fetch(`${BACKEND_URL}/api/auth/teacher/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-requested-with': 'api' },
      body: JSON.stringify({ phone_number: 'demo-teacher', password: 'demo' }),
    });
    if (!tLogin.ok) throw new Error(`Teacher login failed: ${tLogin.status}`);
    
    const tCookies = tLogin.headers.getSetCookie ? tLogin.headers.getSetCookie() : [tLogin.headers.get('set-cookie')];
    tAuthCookie = tCookies.find(c => c && c.startsWith('auth_token='))?.split(';')[0] || '';

    // Negative CSRF test
    const csrfFail = await fetch(`${BACKEND_URL}/api/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tAuthCookie },
      body: JSON.stringify({}),
    });
    if (csrfFail.status !== 403) throw new Error(`Negative CSRF test failed, got ${csrfFail.status} instead of 403`);
    console.log('✅ CSRF Protection working (403 without header)');

    const start = await fetch(`${BACKEND_URL}/api/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-requested-with': 'api', Cookie: tAuthCookie },
      body: JSON.stringify({}),
    });
    if (!start.ok) throw new Error(`Start session failed: ${start.status}`);
    const { session, deepLinkUrl } = await start.json();

    const u = new URL(deepLinkUrl);
    const session_id = u.searchParams.get('session_id');
    const nonce = u.searchParams.get('nonce');
    const t = u.searchParams.get('t');
    const sig = u.searchParams.get('sig');

    const sLogin = await fetch(`${BACKEND_URL}/api/auth/student/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-requested-with': 'api' },
      body: JSON.stringify({ roll_number: 'DEMO001', password: 'demo' }),
    });
    if (!sLogin.ok) throw new Error(`Student login failed: ${sLogin.status} ${(await sLogin.text())}`);
    
    const sCookies = sLogin.headers.getSetCookie ? sLogin.headers.getSetCookie() : [sLogin.headers.get('set-cookie')];
    sAuthCookie = sCookies.find(c => c && c.startsWith('auth_token='))?.split(';')[0] || '';
    deviceCookie = sCookies.find(c => c && c.startsWith('device_token='))?.split(';')[0] || '';

    const cookiesToSend = [sAuthCookie, deviceCookie].filter(Boolean).join('; ');

    const res = await fetch(`${BACKEND_URL}/api/attendance/check-in`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-requested-with': 'api',
        Cookie: cookiesToSend,
      },
      body: JSON.stringify({
        session_id, nonce, t, sig,
        gps_lat: parseFloat(process.env.CAMPUS_LAT || '12.9716'),
        gps_lng: parseFloat(process.env.CAMPUS_LNG || '77.5946'),
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(`Check-in failed: ${res.status} ${JSON.stringify(data)}`);
    console.log('✅ Check-in response:', data);

    await pool.query('DELETE FROM attendance_logs WHERE session_id = $1', [session_id]);
    await pool.query('DELETE FROM sessions WHERE id = $1', [session_id]);
    console.log('✅ Cleanup done.');
  } catch (e) {
    console.error('❌ INTEGRATION TEST FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runTests();
