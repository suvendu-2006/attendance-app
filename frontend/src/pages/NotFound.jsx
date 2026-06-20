import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#0f172a', color: '#e2e8f0',
      fontFamily: 'Inter, system-ui, sans-serif', textAlign: 'center', padding: '2rem'
    }}>
      <h1 style={{ fontSize: '4rem', fontWeight: 'bold', color: '#3b82f6', margin: '0' }}>404</h1>
      <p style={{ fontSize: '1.25rem', color: '#94a3b8', margin: '1rem 0 2rem' }}>Page not found</p>
      <Link to="/login" style={{
        padding: '0.75rem 1.5rem', borderRadius: '0.5rem',
        background: '#3b82f6', color: 'white', textDecoration: 'none', fontSize: '1rem'
      }}>
        Go to Login
      </Link>
    </div>
  );
}
