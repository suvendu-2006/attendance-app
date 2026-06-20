import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { isInAppBrowser } from '../utils/browserDetection';
import InAppBrowserWarning from '../components/InAppBrowserWarning';
import { storage, apiFetch, getPosition } from '../utils/api';

const CheckIn = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('Verifying your attendance...');

  useEffect(() => {
    if (isInAppBrowser()) { setStatus('browser-warning'); return; }

    const sessionId = searchParams.get('session_id');
    const nonce = searchParams.get('nonce');
    const timestamp = searchParams.get('t');
    const sig = searchParams.get('sig');

    if (!sessionId || !nonce || !timestamp || !sig) {
      setStatus('error'); setMessage('Invalid check-in link. Missing parameters.'); return;
    }

    const token = storage.getStudentToken();
    if (!token) {
      const returnTo = `/check-in?session_id=${sessionId}&nonce=${nonce}&t=${timestamp}&sig=${sig}`;
      navigate(`/student-login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }

    const run = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        let position;
        try {
          position = await getPosition();
        } catch (gpsErr) {
          setStatus('gps-error');
          setMessage(gpsErr.message || 'GPS access is required. Tap retry.');
          return;
        }

        const res = await apiFetch('/api/attendance/check-in', {
          role: 'student',
          method: 'POST',
          body: {
            session_id: sessionId, nonce, t: timestamp, sig,
            gps_lat: position.coords.latitude, gps_lng: position.coords.longitude,
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          setStatus('error'); setMessage('Server returned an unexpected response.'); return;
        }
        const data = await res.json();
        if (res.ok) { setStatus('success'); setMessage(data.message || 'Attendance marked! You are PRESENT.'); }
        else if (res.status === 401) {
          storage.clearStudent();
          const returnTo = `/check-in?session_id=${sessionId}&nonce=${nonce}&t=${timestamp}&sig=${sig}`;
          navigate(`/student-login?returnTo=${encodeURIComponent(returnTo)}`);
        }
        else { setStatus('error'); setMessage(data.message || data.error || 'Failed to mark attendance.'); }
      } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') { setStatus('error'); setMessage('Request timed out. Tap retry.'); }
        else { setStatus('error'); setMessage('A network error occurred. Tap retry.'); }
      }
    };
    run();
  }, [searchParams, navigate]);

  const retry = () => { setStatus('loading'); setMessage('Retrying...');
    setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('retry', Date.now()); return p; });
  };

  if (status === 'browser-warning') return <InAppBrowserWarning />;

  return (
    <div className="page-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" role="status" aria-live="polite" style={{ width: '100%', textAlign: 'center', padding: '40px 20px' }}>
        {status === 'loading' && (
          <>
            <Loader2 size={64} color="var(--primary)" style={{ margin: '0 auto 20px', animation: 'spin 1s linear infinite' }} />
            <h2 style={{ marginBottom: '10px' }}>Verifying Identity</h2>
            <p style={{ color: 'var(--text-secondary)' }}>{message}</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle size={64} color="var(--success)" style={{ margin: '0 auto 20px' }} />
            <h2 style={{ marginBottom: '10px', color: 'var(--success)' }}>Verified</h2>
            <p style={{ color: 'var(--text-secondary)' }}>{message}</p>
          </>
        )}
        {(status === 'error' || status === 'gps-error') && (
          <>
            <XCircle size={64} color="var(--danger)" style={{ margin: '0 auto 20px' }} />
            <h2 style={{ marginBottom: '10px', color: 'var(--danger)' }}>{status === 'gps-error' ? 'Location Needed' : 'Access Denied'}</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>{message}</p>
            <button onClick={retry} style={{ padding: '0.6rem 1.2rem', borderRadius: '0.5rem', border: 'none', background: '#3b82f6', color: 'white', fontSize: '1rem', cursor: 'pointer' }}>Retry</button>
          </>
        )}
      </div>
    </div>
  );
};

export default CheckIn;
