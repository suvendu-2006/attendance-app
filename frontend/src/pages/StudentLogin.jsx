import { useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { BACKEND_URL, storage } from '../utils/api';

export default function StudentLogin() {
  const [roll, setRoll] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const returnTo = searchParams.get('returnTo') || `/check-in${location.search}`;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/student/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-requested-with': 'api' },
        credentials: 'include',
        body: JSON.stringify({ roll_number: roll, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === 'DEVICE_MISMATCH') {
          // Tell the UI we need to register
          setError(data.message);
          return;
        }
        setError(data.message || data.error || 'Login failed');
        return;
      }
      storage.setStudent(data.token);
      navigate(returnTo);
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterDevice = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/student/register-device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-requested-with': 'api' },
        credentials: 'include',
        body: JSON.stringify({ roll_number: roll, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || data.error || 'Registration failed');
        return;
      }
      storage.setStudent(data.token);
      navigate(returnTo);
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', fontFamily: 'Inter, system-ui, sans-serif', padding: '1rem' }}>
      <form onSubmit={handleSubmit} style={{ background: '#1e293b', borderRadius: '1rem', padding: '2.5rem',
        width: '100%', maxWidth: '400px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
        <h1 style={{ color: '#e2e8f0', fontSize: '1.5rem', marginBottom: '0.5rem', textAlign: 'center' }}>Student Login</h1>
        <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '1.5rem', textAlign: 'center' }}>Sign in to mark attendance</p>
        {error && <div role="alert" style={{ background: '#7f1d1d33', border: '1px solid #7f1d1d', borderRadius: '0.5rem', padding: '0.75rem', marginBottom: '1rem', color: '#fca5a5', fontSize: '0.875rem' }}>{error}</div>}
        <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.875rem', marginBottom: '0.375rem' }}>Roll Number</label>
        <input value={roll} onChange={(e) => setRoll(e.target.value)} required placeholder="Enter roll number" style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: '1rem', marginBottom: '1rem', outline: 'none', boxSizing: 'border-box' }} />
        <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.875rem', marginBottom: '0.375rem' }}>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Enter password" style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: '1rem', marginBottom: '1.5rem', outline: 'none', boxSizing: 'border-box' }} />
        <button type="submit" disabled={loading} style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: 'none', background: loading ? '#1e40af' : '#3b82f6', color: 'white', fontSize: '1rem', cursor: loading ? 'not-allowed' : 'pointer', transition: 'background 0.2s', marginTop: '1rem' }}>{loading ? 'Signing in...' : 'Sign In'}</button>
        
        {error && error.includes('Unregistered device') && (
          <button 
            type="button" 
            onClick={handleRegisterDevice} 
            disabled={loading} 
            style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #3b82f6', background: 'transparent', color: '#3b82f6', fontSize: '1rem', cursor: loading ? 'not-allowed' : 'pointer', transition: 'background 0.2s', marginTop: '1rem' }}
          >
            {loading ? 'Registering...' : 'Register this Device'}
          </button>
        )}

        <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
            Are you a teacher?{' '}
            <button
              type="button"
              onClick={() => navigate('/login')}
              style={{
                background: 'none', border: 'none', color: '#3b82f6',
                textDecoration: 'underline', cursor: 'pointer', padding: 0,
                fontFamily: 'inherit', fontSize: 'inherit'
              }}
            >
              Teacher Login
            </button>
          </p>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginTop: '0.5rem' }}>
            First time?{' '}
            <button
              type="button"
              onClick={() => navigate('/student-activate')}
              style={{
                background: 'none', border: 'none', color: '#3b82f6',
                textDecoration: 'underline', cursor: 'pointer', padding: 0,
                fontFamily: 'inherit', fontSize: 'inherit'
              }}
            >
              Activate your account
            </button>
          </p>
        </div>
      </form>
    </div>
  );
}
