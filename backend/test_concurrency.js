const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const API_BASE = 'http://localhost:5001/api';

async function apiCall(endpoint, method = 'GET', body = null, cookie = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (['POST', 'PUT', 'DELETE'].includes(method)) headers['X-Requested-With'] = 'api';
  if (cookie) headers['Cookie'] = cookie;

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  let newCookie = cookie || '';
  if (res.headers.getSetCookie) {
    const cookies = res.headers.getSetCookie();
    const tokenParts = cookies.map(c => c.split(';')[0]);
    
    // Merge new tokenParts into existing cookie string
    const cookieMap = {};
    if (newCookie) {
      newCookie.split('; ').forEach(part => {
        const [k, v] = part.split('=');
        if (k && v) cookieMap[k] = v;
      });
    }
    tokenParts.forEach(part => {
      const [k, v] = part.split('=');
      if (k && v) cookieMap[k] = v;
    });
    
    newCookie = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  return { status: res.status, data, cookie: newCookie };
}

async function runTests() {
  console.log('=== Starting Concurrency & Load Tests ===\\n');

  try {
    // 1. Seed 50 students
    console.log('1. Seeding 50 test students...');
    const hashedPwd = await bcrypt.hash('password', 10);
    const students = [];
    for (let i = 1; i <= 50; i++) {
      const roll = `LOADTEST${String(i).padStart(3, '0')}`;
      const res = await pool.query(
        `INSERT INTO students (roll_number, name, password_hash, is_active, phone_number)
         VALUES ($1, $2, $3, true, $4)
         ON CONFLICT (roll_number) DO UPDATE SET is_active = true
         RETURNING id`,
        [roll, `Test Student ${i}`, hashedPwd, `555000${String(i).padStart(3, '0')}`]
      );
      students.push({ id: res.rows[0].id, roll, password: 'password', cookie: null });
    }

    // Clear their devices so they can register
    await pool.query('DELETE FROM devices WHERE student_id = ANY($1)', [students.map(s => s.id)]);

    // Register all students to get their cookies
    console.log('   Registering devices to get authentication tokens...');
    for (let i = 0; i < students.length; i++) {
      const regRes = await apiCall('/auth/student/register-device', 'POST', {
        roll_number: students[i].roll,
        password: students[i].password
      });
      if (regRes.status !== 200) {
        console.error(`Failed to register student ${i + 1}:`, regRes.status, regRes.data);
        continue;
      }
      
      const loginRes = await apiCall('/auth/student/login', 'POST', {
        roll_number: students[i].roll,
        password: students[i].password
      }, regRes.cookie);
      
      if (loginRes.status === 200) {
        students[i].cookie = loginRes.cookie;
      } else {
        console.error(`Failed to login student ${i + 1}:`, loginRes.status, loginRes.data);
      }
    }
    console.log('\\n2. Starting an attendance session...');
    const teacherLogin = await apiCall('/auth/teacher/login', 'POST', {
      phone_number: 'demo-teacher',
      password: 'demo'
    });
    if (teacherLogin.status !== 200) throw new Error('Teacher login failed');

    const sessionStart = await apiCall('/sessions/start', 'POST', null, teacherLogin.cookie);
    if (sessionStart.status !== 200) throw new Error('Failed to start session');

    const deepLinkUrl = sessionStart.data.deepLinkUrl;
    const urlParams = new URLSearchParams(deepLinkUrl.split('?')[1]);
    const checkInPayload = {
      session_id: urlParams.get('session_id'),
      nonce: urlParams.get('nonce'),
      t: urlParams.get('t'),
      sig: urlParams.get('sig'),
      gps_lat: parseFloat(process.env.CAMPUS_LAT),
      gps_lng: parseFloat(process.env.CAMPUS_LNG)
    };

    // 3. The "Stampede" Test
    console.log('\\n3. Running Stampede Test (50 concurrent check-ins)...');
    const stampedePromises = students.map(student => 
      apiCall('/attendance/check-in', 'POST', checkInPayload, student.cookie)
    );

    const stampedeStart = Date.now();
    const stampedeResults = await Promise.all(stampedePromises);
    const stampedeDuration = Date.now() - stampedeStart;

    const stampedeStatuses = stampedeResults.reduce((acc, res) => {
      acc[res.status] = (acc[res.status] || 0) + 1;
      return acc;
    }, {});

    console.log(`   Completed in ${stampedeDuration}ms.`);
    console.log(`   HTTP Statuses received:`, stampedeStatuses);
    if (stampedeStatuses[401]) {
      console.log(`   Reason for 401:`, stampedeResults.find(r => r.status === 401)?.data);
    }
    
    if (stampedeStatuses[429]) {
      console.log('   [WARNING] IP-based rate limiting blocked some check-ins! This means students on campus Wi-Fi might get blocked.');
    }

    // Count DB entries
    const dbCountRes = await pool.query('SELECT count(*) FROM attendance_logs WHERE session_id = $1', [checkInPayload.session_id]);
    console.log(`   Database attendance records created: ${dbCountRes.rows[0].count}`);

    // 4. The "Race Condition" Test (Double Clicks)
    console.log('\\n4. Running Race Condition Test (10 rapid check-ins from 1 student)...');
    
    // Create a new session to ensure clean slate
    const newSessionStart = await apiCall('/sessions/start', 'POST', null, teacherLogin.cookie);
    const newDeepLinkUrl = newSessionStart.data.deepLinkUrl;
    const newUrlParams = new URLSearchParams(newDeepLinkUrl.split('?')[1]);
    const newCheckInPayload = {
      session_id: newUrlParams.get('session_id'),
      nonce: newUrlParams.get('nonce'),
      t: newUrlParams.get('t'),
      sig: newUrlParams.get('sig'),
      gps_lat: parseFloat(process.env.CAMPUS_LAT),
      gps_lng: parseFloat(process.env.CAMPUS_LNG)
    };

    const targetStudent = students[0];
    const racePromises = Array(10).fill(0).map(() => 
      apiCall('/attendance/check-in', 'POST', newCheckInPayload, targetStudent.cookie)
    );

    const raceStart = Date.now();
    const raceResults = await Promise.all(racePromises);
    const raceDuration = Date.now() - raceStart;

    const raceStatuses = raceResults.reduce((acc, res) => {
      acc[res.status] = (acc[res.status] || 0) + 1;
      return acc;
    }, {});

    console.log(`   Completed in ${raceDuration}ms.`);
    console.log(`   HTTP Statuses received:`, raceStatuses);

    const raceDbCountRes = await pool.query(
      'SELECT count(*) FROM attendance_logs WHERE session_id = $1 AND student_id = $2',
      [newCheckInPayload.session_id, targetStudent.id]
    );
    console.log(`   Database attendance records created for this student: ${raceDbCountRes.rows[0].count} (Expected: 1)`);
    if (parseInt(raceDbCountRes.rows[0].count) > 1) {
      console.log('   [CRITICAL FAIL] Race condition resulted in duplicate attendance records!');
    } else {
      console.log('   [PASS] Database successfully prevented duplicate records.');
    }

  } catch (err) {
    console.error('Test script failed:', err);
  } finally {
    await pool.end();
    console.log('\\n=== Tests Complete ===');
  }
}

runTests();
