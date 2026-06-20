import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { apiFetch, storage } from '../utils/api';
import { Loader2 } from 'lucide-react';

export default function ProtectedRoute({ children, role = 'teacher' }) {
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    // Basic synchronous check first to prevent network call if completely logged out
    const hasFlag = role === 'teacher' ? storage.getTeacherToken() : storage.getStudentToken();
    if (!hasFlag) {
      setStatus('unauthorized');
      return;
    }

    const checkAuth = async () => {
      try {
        const res = await apiFetch('/api/auth/me', { role });
        if (res.ok) {
          const data = await res.json();
          if (data.authenticated && data.user.role === role) {
            setStatus('authorized');
            return;
          }
        }
        // If we get here, either 401 or invalid role
        setStatus('unauthorized');
      } catch (err) {
        // Network error - we might want to just allow them if they have the flag, or show error.
        // Let's assume offline means we can't verify, but if we need strict, we show error.
        // But for attendance, teacher needs online anyway.
        setStatus('unauthorized');
      }
    };
    checkAuth();
  }, [role]);

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
        <Loader2 size={48} color="#3b82f6" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (status === 'unauthorized') {
    return <Navigate to={role === 'teacher' ? '/login' : '/student-login'} replace />;
  }

  return children;
}
