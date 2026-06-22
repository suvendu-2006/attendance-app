export const BACKEND_URL = '';
const TEACHER_KEY = 'is_teacher_authed';
const STUDENT_KEY = 'is_student_authed';
const TEACHER_ID_KEY = 'teacher_id';

export async function apiFetch(path, { role, method = 'GET', body, signal } = {}) {
  const headers = { 'Content-Type': 'application/json' };

  // CSRF: custom header on state-changing requests (matching server-side check)
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())) {
    headers['X-Requested-With'] = 'api';
  }

  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    credentials: 'include',   // (Issue 5) always send cookies — device_token + role auth
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  // Centralized 401 handling — clear flags and redirect to correct login page
  if (res.status === 401) {
    if (role === 'teacher') storage.clearTeacher();
    else storage.clearStudent();

    // Validate session via /me (Fix 44: cookie + localStorage desync tiebreaker)
    // If /me also 401s, the cookie really expired → redirect.
    // If /me succeeds, the 401 was a race or different role → don't redirect.
    try {
      const meRes = await fetch(`${BACKEND_URL}/api/auth/me`, {
        credentials: 'include',
        headers: { 'X-Requested-With': 'api' },
      });
      if (meRes.ok) return res; // session still valid — the 401 was for a different role/action
    } catch { /* network error — fall through to redirect */ }

    if (!window.location.pathname.includes('/login') && !window.location.pathname.includes('/student-login')) {
      window.location.href = role === 'teacher' ? '/login' : '/student-login';
    }
  }

  return res;
}

// (Issue 44) GPS with coarse→fine fallback + structured error
export function getPosition() {
  return new Promise((resolve, reject) => {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      console.log('Local environment detected: Mocking GPS coordinates to match campus.');
      return resolve({ coords: { latitude: 12.9716, longitude: 77.5946 } });
    }
    if (!('geolocation' in navigator)) {
      return reject(new Error('Geolocation is not supported on this device.'));
    }
    const coarse = { enableHighAccuracy: false, timeout: 6000, maximumAge: 0 };
    const fine = { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 };
    navigator.geolocation.getCurrentPosition(
      resolve,
      () => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          (err) => reject(new Error(err.code === 1 ? 'Location permission denied.' : 'Could not get GPS. Try again.')),
          fine
        );
      },
      coarse
    );
  });
}

// Storage: boolean flags only (the real token lives in HTTP-only cookies)
export const storage = {
  setTeacher: (token, id) => {
    localStorage.setItem(TEACHER_KEY, 'true');
    if (id) localStorage.setItem(TEACHER_ID_KEY, id);
  },
  getTeacherToken: () => localStorage.getItem(TEACHER_KEY),
  getTeacherId: () => localStorage.getItem(TEACHER_ID_KEY),
  clearTeacher: () => {
    localStorage.removeItem(TEACHER_KEY);
    localStorage.removeItem(TEACHER_ID_KEY);
  },

  setStudent: (token) => localStorage.setItem(STUDENT_KEY, 'true'),
  getStudentToken: () => localStorage.getItem(STUDENT_KEY),
  clearStudent: () => localStorage.removeItem(STUDENT_KEY),
};
