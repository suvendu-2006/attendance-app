import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Play, Share2, Clock, CheckCircle2, LogOut, Copy, Trash2, Users, ShieldAlert } from 'lucide-react';
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
  const socketRef = useRef(null);
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

  useEffect(() => {
    if (isAdmin && showAdminPanel) {
      fetchStudents();
    }
  }, [isAdmin, showAdminPanel]);

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
          }
        }
      } catch (err) {
        console.error('Failed to fetch active session:', err);
      }
    };

    fetchActiveSession();
  }, []);

  // Connect Socket.io with HTTP-only cookies cross-origin
  useEffect(() => {
    if (!storage.getTeacherToken()) return;

    const newSocket = io(BACKEND_URL, {
      withCredentials: true
    });

    newSocket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
    });

    socketRef.current = newSocket;
    return () => newSocket.close();
  }, []);

  // Dynamic Socket Room Join & Live Event Listeners
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !session?.teacher_id) return;

    socket.emit('join_teacher_room', session.teacher_id);

    const handleSessionStarted = (data) => {
      setSession(data.session);
      setDeepLink(data.deepLinkUrl);
    };

    const handleSessionExtended = (data) => {
      setSession((prev) => ({ ...prev, expires_at: data.newExpiresAt }));
    };

    const handleAttendanceRecorded = (data) => {
      setPresentStudents((prev) => {
        if (prev.find(s => s.id === data.student_id)) return prev;
        return [...prev, { id: data.student_id, name: data.name }];
      });
    };

    socket.on('session_started', handleSessionStarted);
    socket.on('session_extended', handleSessionExtended);
    socket.on('attendance_recorded', handleAttendanceRecorded);

    return () => {
      socket.off('session_started', handleSessionStarted);
      socket.off('session_extended', handleSessionExtended);
      socket.off('attendance_recorded', handleAttendanceRecorded);
    };
  }, [session?.teacher_id]);

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
    const text = encodeURIComponent(`AI/ML Attendance is open! Tap to mark present. Window closes in 90 seconds.\n\n${deepLink}`);
    window.location.href = `https://wa.me/?text=${text}`;
  };

  return (
    <div className="page-container">
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
        </>
      )}
    </div>
  );
};

export default TeacherDashboard;
