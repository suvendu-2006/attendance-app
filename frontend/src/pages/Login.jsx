import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { storage } from '../utils/api';

const BACKEND_URL = '';

export default function Login() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/teacher/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-requested-with': 'api' },
        credentials: 'include',
        body: JSON.stringify({ phone_number: phoneNumber, password }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Server returned an unexpected response');
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed. Please check your credentials.');
        return;
      }

      storage.setTeacher("true", data.teacher?.id || data.teacher_id);
      navigate('/teacher');
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        setError('Request timed out. Please try again.');
      } else {
        setError('Network error. Please check your connection.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      fontFamily: 'Inter, system-ui, sans-serif', padding: '1rem'
    }}>
      <form onSubmit={handleSubmit} style={{
        background: '#1e293b', borderRadius: '1rem', padding: '2.5rem',
        width: '100%', maxWidth: '400px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
      }}>
        <h1 style={{ color: '#e2e8f0', fontSize: '1.5rem', marginBottom: '0.5rem', textAlign: 'center' }}>
          Teacher Login
        </h1>
        <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '1.5rem', textAlign: 'center' }}>
          AI/ML Attendance System
        </p>

        {error && (
          <div role="alert" style={{
            background: '#7f1d1d33', border: '1px solid #7f1d1d', borderRadius: '0.5rem',
            padding: '0.75rem', marginBottom: '1rem', color: '#fca5a5', fontSize: '0.875rem'
          }}>
            {error}
          </div>
        )}

        <label htmlFor="phone" style={{ display: 'block', color: '#94a3b8', fontSize: '0.875rem', marginBottom: '0.375rem' }}>
          Phone Number
        </label>
        <input
          id="phone" type="text" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)}
          required autoComplete="username" placeholder="Enter phone number"
          style={{
            width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #334155',
            background: '#0f172a', color: '#e2e8f0', fontSize: '1rem', marginBottom: '1rem',
            outline: 'none', boxSizing: 'border-box'
          }}
        />

        <label htmlFor="password" style={{ display: 'block', color: '#94a3b8', fontSize: '0.875rem', marginBottom: '0.375rem' }}>
          Password
        </label>
        <input
          id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          required autoComplete="current-password" placeholder="Enter password"
          style={{
            width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #334155',
            background: '#0f172a', color: '#e2e8f0', fontSize: '1rem', marginBottom: '1.5rem',
            outline: 'none', boxSizing: 'border-box'
          }}
        />

        <button
          type="submit" disabled={loading}
          style={{
            width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: 'none',
            background: '#3b82f6', color: 'white', fontSize: '1rem', fontWeight: '500',
            cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
            transition: 'background 0.2s', marginTop: '1rem'
          }}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>

        <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
            Are you a student?{' '}
            <button
              type="button"
              onClick={() => navigate('/student-login')}
              style={{
                background: 'none', border: 'none', color: '#3b82f6',
                textDecoration: 'underline', cursor: 'pointer', padding: 0,
                fontFamily: 'inherit', fontSize: 'inherit'
              }}
            >
              Student Login
            </button>
          </p>
        </div>
      </form>
    </div>
  );
}
