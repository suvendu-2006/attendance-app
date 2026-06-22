import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Share2, Clock, CheckCircle2, LogOut, Copy, Trash2, Users, ShieldAlert, WifiOff, AlertTriangle } from 'lucide-react';
import { BACKEND_URL, apiFetch, storage } from '../utils/api';

const TeacherDashboard = () => {
  const [session, setSession] = useState(null);
  const [deepLink, setDeepLink] = useState('');
  const [presentStudents, setPresentStudents] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [allStudents, setAllStudents] = useState([]);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connected');
  const failureCount = useRef(0);
  const [sessionExpiring, setSessionExpiring] = useState(false);
  const [flags, setFlags] = useState([]);
  const [guestRequests, setGuestRequests] = useState([]);
  const [guestConfirmNames, setGuestConfirmNames] = useState({});
  const navigate = useNavigate();

  const teacherId = storage.getTeacherId();

  // Redirect to login if no flag
  useEffect(() => {
    if (!storage.getTeacherToken()) {
      navigate('/login');
    }
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST', role: 'teacher' });
    } catch (e) {
      // ignore
    }
    storage.clearTeacher();
    navigate('/login');
  };

  // Fetch admin status
  useEffect(() => {
    if (!storage.getTeacherToken()) return;
    const fetchMe = async () => {
      try {
        const res = await apiFetch('/api/auth/me', { role: 'teacher' });
        if (res.ok) {
          const data = await res.json();
          if (data.user?.is_admin) {
            setIsAdmin(true);
          }
          if (data.iat || data.token_iat) {
            const iat = data.iat || data.token_iat;
            if (Date.now()/1000 - iat > 7 * 60 * 60) setSessionExpiring(true);
          } else {
            const token = storage.getTeacherToken();
            if (token && token.length > 20 && token.includes('.')) {
              try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                if (Date.now()/1000 - payload.iat > 7 * 60 * 60) setSessionExpiring(true);
              } catch (e) {}
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch user status:', err);
      }
    };
    fetchMe();
  }, []);

  const fetchStudents = async () => {
    try {
      const res = await apiFetch('/api/auth/admin/students', { role: 'teacher' });
      if (res.ok) {
        const data = await res.json();
        setAllStudents(data.students || []);
      }
    } catch (err) {
      console.error('Failed to fetch students:', err);
    }
  };

  const fetchFlags = async () => {
    try {
      const res = await apiFetch('/api/auth/admin/flags', { role: 'teacher' });
      if (res.ok) {
        const data = await res.json();
        setFlags(data.flags || []);
      }
    } catch (err) {}
  };

  useEffect(() => {
    if (isAdmin && showAdminPanel) {
      fetchStudents();
      fetchFlags();
    }
  }, [isAdmin, showAdminPanel]);

  const renewSession = async () => {
    await apiFetch('/api/auth/me', { role: 'teacher' });
    setSessionExpiring(false);
  };

  const handleSoftDelete = async (studentId) => {
    if (!window.confirm("Are you sure you want to soft-delete this student?")) return;
    try {
      const res = await apiFetch('/api/auth/admin/soft-delete-student', {
        method: 'POST',
        role: 'teacher',
        body: { student_id: studentId }
      });
      if (res.ok) {
        setAllStudents(prev => prev.filter(s => s.id !== studentId));
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to delete student');
      }
    } catch (err) {
      setError('Network error while deleting student');
    }
  };

  // Fetch and restore active session state on mount
  useEffect(() => {
    if (!storage.getTeacherToken()) return;

    const fetchActiveSession = async () => {
      try {
        const response = await apiFetch('/api/sessions/active', { role: 'teacher' });
        if (!response) return;
        if (response.ok) {
          const data = await response.json();
          if (data.active) {
            setSession(data.session);
            setDeepLink(data.session.deep_link_url);
            setPresentStudents(data.checkedInStudents || []);
            setGuestRequests(data.guestRequests || []);
          }
        }
      } catch (err) {
        console.error('Failed to fetch active session:', err);
      }
    };

    fetchActiveSession();
  }, []);

  // HTTP Polling for Live Updates (Replaces WebSockets for Vercel)
  useEffect(() => {
    if (!storage.getTeacherToken()) return;

    const pollSession = async () => {
      try {
        const response = await apiFetch('/api/sessions/active', { role: 'teacher' });
        if (!response || !response.ok) {
          failureCount.current += 1;
          if (failureCount.current >= 2) setConnectionStatus('disconnected');
          return;
        }
        
        failureCount.current = 0;
        if (connectionStatus === 'disconnected') setConnectionStatus('connected');
        
        const data = await response.json();
        if (data.active) {
          setSession(data.session);
          setDeepLink(data.session.deep_link_url);
          setPresentStudents(data.checkedInStudents || []);
          setGuestRequests(data.guestRequests || []);
        } else {
          // If session expired, don't clear the view immediately so they can see the final list,
          // but we could update the session status locally if we wanted.
          setSession(prev => prev ? { ...prev, status: 'EXPIRED' } : null);
        }
      } catch (err) {
        console.error('Polling error:', err);
        failureCount.current += 1;
        if (failureCount.current >= 2) setConnectionStatus('disconnected');
      }
    };

    const intervalId = setInterval(pollSession, 3000);
    return () => clearInterval(intervalId);
  }, [connectionStatus]);

  const handleApproveGuest = async (reqId) => {
    const confirmName = guestConfirmNames[reqId] || '';
    if (!confirmName.trim()) {
      setError("Please type the student's name to approve.");
      return;
    }
    setError('');
    try {
      const response = await apiFetch('/api/overrides/approve-guest', {
        role: 'teacher',
        method: 'POST',
        body: { request_id: reqId, confirm_name: confirmName }
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Failed to approve guest');
      } else {
        setGuestRequests(prev => prev.filter(r => r.id !== reqId));
        setGuestConfirmNames(prev => { const n = {...prev}; delete n[reqId]; return n; });
      }
    } catch (err) {
      setError('Network error. Could not approve guest.');
    }
  };

  const handleStartAttendance = async () => {
    setError('');
    setLoading(true);
    try {
      const response = await apiFetch('/api/sessions/start', {
        role: 'teacher',
        method: 'POST',
        body: {}
      });
      if (!response) return;
      if (!response.ok) {
        const errData = await response.json();
        setError(errData.error || 'Failed to start session');
        return;
      }
      const data = await response.json();
      setSession(data.session);
      setDeepLink(data.deepLinkUrl);
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Request timed out. Please try again.');
      } else {
        setError('Network error. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleExtendWindow = async () => {
    setError('');
    try {
      const response = await apiFetch('/api/sessions/extend', {
        role: 'teacher',
        method: 'POST',
        body: { session_id: session.id }
      });
      if (!response) return;
      if (!response.ok) {
        setError('Failed to extend window');
      }
    } catch (err) {
      setError('Network error. Could not extend session.');
    }
  };

  const handleShareToWhatsApp = () => {
    const text = encodeURIComponent(`AI/ML Attendance is open! Tap to mark present. Window closes in 5 minutes.\n\n${deepLink}`);
    window.location.href = `https://wa.me/?text=${text}`;
  };

  return (
    <>
      {sessionExpiring && (
        <div onClick={renewSession} style={{ background: '#f59e0b', color: 'white', padding: '12px', textAlign: 'center', cursor: 'pointer', fontWeight: 'bold', width: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1000 }}>
          Session expiring soon — click to renew
        </div>
      )}
      {connectionStatus === 'disconnected' && (
        <div style={{ position: 'fixed', bottom: '20px', right: '20px', background: 'var(--danger)', color: 'white', padding: '10px 20px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', zIndex: 1000, boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
          <WifiOff size={16} /> Connection lost — retrying...
        </div>
      )}
      <div className="page-container" style={{ paddingTop: sessionExpiring ? '60px' : '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold' }}>Teacher Dashboard</h1>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          {session && (
            <div style={{ backgroundColor: 'var(--surface)', padding: '8px 16px', borderRadius: '20px', fontSize: '14px', color: 'var(--success)' }}>
              ● Live
            </div>
          )}
          <button onClick={handleLogout} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <LogOut size={20} />
            Logout
          </button>
        </div>
      </div>

      {isAdmin && (
        <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
          <button 
            className={`btn-primary ${showAdminPanel ? 'active' : ''}`} 
            onClick={() => setShowAdminPanel(!showAdminPanel)}
            style={{ 
              display: 'flex', alignItems: 'center', gap: '8px', 
              backgroundColor: showAdminPanel ? 'var(--primary)' : 'var(--surface)',
              color: showAdminPanel ? 'white' : 'var(--text-primary)',
              border: '1px solid var(--surface-border)'
            }}
          >
            <ShieldAlert size={20} />
            {showAdminPanel ? 'Hide Admin Panel' : 'Show Admin Panel'}
          </button>
        </div>
      )}

      {showAdminPanel && isAdmin && (
        <div className="card" style={{ marginBottom: '20px', border: '1px solid #ef4444' }}>
          <h2 style={{ marginBottom: '16px', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444' }}>
            <Users size={24} />
            Student Management (Admin)
          </h2>
          
          <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button 
              onClick={handleGenerateInvite}
              className="btn-primary"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              Generate Teacher Invite
            </button>
            <div style={{ position: 'relative' }}>
              <input 
                type="file" 
                accept=".csv" 
                onChange={handleCSVUpload}
                style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                disabled={loading}
              />
              <button 
                className="btn-primary"
                style={{ backgroundColor: '#22c55e' }}
                disabled={loading}
              >
                {loading ? 'Uploading...' : 'Import Students CSV'}
              </button>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--surface-border)' }}>
                  <th style={{ padding: '12px 8px', color: 'var(--text-secondary)' }}>Roll Number</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-secondary)' }}>Name</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-secondary)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {allStudents.length === 0 ? (
                  <tr><td colSpan="3" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>No active students found.</td></tr>
                ) : (
                  allStudents.map(student => (
                    <tr key={student.id} style={{ borderBottom: '1px solid var(--surface-border)' }}>
                      <td style={{ padding: '12px 8px', fontWeight: '500' }}>{student.roll_number}</td>
                      <td style={{ padding: '12px 8px' }}>{student.name}</td>
                      <td style={{ padding: '12px 8px' }}>
                        <button 
                          onClick={() => handleSoftDelete(student.id)}
                          style={{ 
                            background: '#fee2e2', color: '#ef4444', border: 'none', 
                            padding: '6px 12px', borderRadius: '4px', cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 'bold'
                          }}
                        >
                          <Trash2 size={14} /> Soft Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h2 style={{ marginTop: '30px', marginBottom: '16px', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px', color: '#f59e0b' }}>
            <AlertTriangle size={24} />
            Security Flags
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--surface-border)' }}>
                  <th style={{ padding: '12px 8px', color: 'var(--text-secondary)' }}>Student</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-secondary)' }}>Reason</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-secondary)' }}>GPS Coordinates</th>
                </tr>
              </thead>
              <tbody>
                {flags.length === 0 ? (
                  <tr><td colSpan="3" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>No security flags found.</td></tr>
                ) : (
                  flags.map(flag => (
                    <tr key={flag.id} style={{ borderBottom: '1px solid var(--surface-border)' }}>
                      <td style={{ padding: '12px 8px', fontWeight: '500' }}>{flag.student_name}</td>
                      <td style={{ padding: '12px 8px' }}>{flag.reason_code}</td>
                      <td style={{ padding: '12px 8px' }}>
                        {flag.gps_lat ? `${parseFloat(flag.gps_lat).toFixed(4)}, ${parseFloat(flag.gps_lng).toFixed(4)}` : 'N/A'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" style={{
          background: '#7f1d1d33', border: '1px solid #7f1d1d', borderRadius: '8px',
          padding: '12px', marginBottom: '16px', color: '#fca5a5', fontSize: '14px'
        }}>
          {error}
        </div>
      )}

      {!session ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <h2 style={{ marginBottom: '20px', color: 'var(--text-secondary)' }}>No Active Session</h2>
          <button className="btn-primary" onClick={handleStartAttendance} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Play size={20} />
            {loading ? 'Starting...' : 'Start Attendance'}
          </button>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: '20px', border: '1px solid var(--primary)' }}>
            <h2 style={{ marginBottom: '16px', fontSize: '20px' }}>Session Active</h2>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
              <button className="btn-primary" onClick={handleShareToWhatsApp} style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#25D366' }}>
                <Share2 size={20} />
                Share to WhatsApp
              </button>
              <button className="btn-primary" onClick={handleExtendWindow} style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--surface-border)' }}>
                <Clock size={20} />
                +30s Time
              </button>
            </div>

            {deepLink && (
              <div style={{ marginTop: '16px', padding: '16px', backgroundColor: 'var(--surface)', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '8px' }}>Session Link (For Testing)</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="text" 
                    readOnly 
                    value={deepLink} 
                    style={{ flex: 1, padding: '8px 12px', borderRadius: '4px', border: '1px solid var(--surface-border)', backgroundColor: 'var(--background)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                  <button 
                    onClick={() => navigator.clipboard.writeText(deepLink)}
                    style={{ padding: '8px 12px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--primary)', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                    title="Copy Link"
                  >
                    <Copy size={16} />
                    Copy
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="card" aria-live="polite">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '20px' }}>Live Check-ins</h2>
              <span role="status" style={{ backgroundColor: 'var(--primary)', color: 'white', padding: '4px 12px', borderRadius: '12px', fontWeight: 'bold' }}>
                {presentStudents.length}
              </span>
            </div>
            
            {presentStudents.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px 0' }}>Waiting for students...</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {presentStudents.map((student) => (
                  <li key={student.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderBottom: '1px solid var(--surface-border)' }}>
                    <CheckCircle2 size={20} color="var(--success)" />
                    <span style={{ fontSize: '16px', fontWeight: '500' }}>{student.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card" aria-live="polite" style={{ marginTop: '20px', border: '1px solid var(--surface-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '20px' }}>Guest Requests</h2>
              <span role="status" style={{ backgroundColor: '#f59e0b', color: 'white', padding: '4px 12px', borderRadius: '12px', fontWeight: 'bold' }}>
                {guestRequests.length}
              </span>
            </div>
            {guestRequests.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px 0' }}>No pending guest requests.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {guestRequests.map((req) => (
                  <li key={req.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 0', borderBottom: '1px solid var(--surface-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                      <span style={{ fontSize: '16px', fontWeight: '500' }}>{req.student_name}</span>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input 
                          type="text" 
                          placeholder="Type student name" 
                          value={guestConfirmNames[req.id] || ''}
                          onChange={(e) => setGuestConfirmNames({...guestConfirmNames, [req.id]: e.target.value})}
                          style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--surface-border)', backgroundColor: 'var(--background)', color: 'white', outline: 'none' }}
                        />
                        <button 
                          onClick={() => handleApproveGuest(req.id)}
                          style={{ padding: '6px 12px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--success)', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}
                        >Approve</button>
                      </div>
                    </div>
                    {(req.gps_lat || req.reason) && (
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', gap: '16px', marginTop: '4px' }}>
                        {req.gps_lat && <span>GPS: {parseFloat(req.gps_lat).toFixed(4)}, {parseFloat(req.gps_lng).toFixed(4)}</span>}
                        {req.reason && <span>Reason: {req.reason}</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
    </>
  );
};

export default TeacherDashboard;
