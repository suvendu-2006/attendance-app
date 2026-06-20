const pool = require('./db');
const { io } = require('socket.io-client');

const BACKEND_URL = 'http://localhost:5001';

async function runRealtimeTest() {
  console.log('🚀 Starting Digital Attendance Real-Time Socket.io Integration Tests...\n');

  let teacherCookie = '';
  let studentCookie = '';
  let deviceCookie = '';
  let teacherId = '';
  let activeSessionId = '';
  let nonce = '';
  let timestamp = '';
  let sig = '';
  let socket = null;

  try {
    // ----------------------------------------------------
    // Test 1: Teacher Login
    // ----------------------------------------------------
    console.log('🔹 Test 1: Authenticating Teacher...');
    const loginRes = await fetch(`${BACKEND_URL}/api/auth/teacher/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-requested-with': 'api' },
      body: JSON.stringify({ phone_number: 'demo-teacher', password: 'demo' })
    });

    if (!loginRes.ok) throw new Error(`Teacher login failed: ${loginRes.status} ${loginRes.statusText}`);

    const loginData = await loginRes.json();
    teacherId = loginData.teacher.id;

    const tCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get('set-cookie')];
    teacherCookie = tCookies.find(c => c && c.startsWith('auth_token='))?.split(';')[0] || '';
    
    console.log(`✅ Teacher authenticated successfully. Teacher ID: ${teacherId}\n`);

    // ----------------------------------------------------
    // Test 2: Establish Socket.io Connection & Join Room
    // ----------------------------------------------------
    console.log('🔹 Test 2: Connecting Socket.io Client and joining teacher room...');
    socket = io(BACKEND_URL, {
      transports: ['websocket'],
      forceNew: true,
      extraHeaders: {
        Cookie: teacherCookie
      }
    });

    // Wait for connection
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket.io connection timeout')), 5000);
      socket.on('connect', () => {
        clearTimeout(timeout);
        console.log('✅ Socket.io connected. Client ID:', socket.id);
        resolve();
      });
      socket.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Socket connection error: ${err.message}`));
      });
    });

    // Join room
    socket.emit('join_teacher_room', teacherId);
    console.log(`✅ Emitted join_teacher_room for teacher_${teacherId}\n`);

    // Setup listener for real-time check-ins
    let receivedRealtimeEvent = null;
    socket.on('attendance_recorded', (data) => {
      console.log('⚡ [SOCKET.IO EVENT RECEIVED] attendance_recorded:', JSON.stringify(data, null, 2));
      receivedRealtimeEvent = data;
    });

    // ----------------------------------------------------
    // Test 3: Start Session
    // ----------------------------------------------------
    console.log('🔹 Test 3: Starting Attendance Session...');
    const startRes = await fetch(`${BACKEND_URL}/api/sessions/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-requested-with': 'api',
        Cookie: teacherCookie
      },
      body: JSON.stringify({})
    });

    if (!startRes.ok) throw new Error(`Failed to start session: ${startRes.status}`);

    const startData = await startRes.json();
    activeSessionId = startData.session.id;

    const u = new URL(startData.deepLinkUrl);
    nonce = u.searchParams.get('nonce');
    timestamp = u.searchParams.get('t');
    sig = u.searchParams.get('sig');

    console.log(`✅ Session started successfully. ID: ${activeSessionId}`);
    console.log(`✅ Extracted parameters from deep link - Nonce: ${nonce}\n`);

    // ----------------------------------------------------
    // Test 4: Student Check-in (Trigger Realtime Event)
    // ----------------------------------------------------
    console.log('🔹 Test 4: Authenticating Student & Triggering Check-In...');
    const sLogin = await fetch(`${BACKEND_URL}/api/auth/student/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-requested-with': 'api' },
      body: JSON.stringify({ roll_number: 'DEMO001', password: 'demo' })
    });
    if (!sLogin.ok) throw new Error(`Student login failed: ${sLogin.status}`);
    
    const sCookies = sLogin.headers.getSetCookie ? sLogin.headers.getSetCookie() : [sLogin.headers.get('set-cookie')];
    studentCookie = sCookies.find(c => c && c.startsWith('auth_token='))?.split(';')[0] || '';
    deviceCookie = sCookies.find(c => c && c.startsWith('device_token='))?.split(';')[0] || '';

    const checkInRes = await fetch(`${BACKEND_URL}/api/attendance/check-in`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-requested-with': 'api',
        Cookie: [studentCookie, deviceCookie].filter(Boolean).join('; ')
      },
      body: JSON.stringify({
        session_id: activeSessionId,
        nonce,
        t: timestamp,
        sig,
        gps_lat: parseFloat(process.env.CAMPUS_LAT || '12.9716'),
        gps_lng: parseFloat(process.env.CAMPUS_LNG || '77.5946')
      })
    });

    const checkInData = await checkInRes.json();
    if (!checkInRes.ok) {
      throw new Error(`Check-in failed: ${checkInRes.status} ${JSON.stringify(checkInData)}`);
    }

    console.log(`✅ Check-in API returned successfully: ${checkInData.message}`);

    // Wait briefly for the websocket event to arrive
    console.log('⏳ Waiting up to 3 seconds for attendance_recorded event...');
    await new Promise(resolve => setTimeout(resolve, 1500));

    if (receivedRealtimeEvent) {
      console.log('🎉 SUCCESS: Real-time event was received correctly!');
    } else {
      throw new Error('Real-time event was NOT received within timeout period!');
    }

  } catch (error) {
    console.error('\n❌ REALTIME TEST FAILED:', error.message);
    process.exitCode = 1;
  } finally {
    // ----------------------------------------------------
    // Cleanup
    // ----------------------------------------------------
    console.log('\n🧹 Cleaning up test data...');
    try {
      if (activeSessionId) {
        await pool.query('DELETE FROM attendance_logs WHERE session_id = $1', [activeSessionId]);
        await pool.query('DELETE FROM nonces WHERE session_id = $1', [activeSessionId]);
        await pool.query('DELETE FROM sessions WHERE id = $1', [activeSessionId]);
      }
      console.log('✅ Database cleanup completed.');
    } catch (e) {
      console.error('⚠️ Cleanup failed:', e.message);
    }
    
    if (socket) {
      socket.disconnect();
      console.log('✅ Socket.io disconnected.');
    }
    await pool.end();
    console.log('✅ Database pool closed.');
  }
}

runRealtimeTest();
