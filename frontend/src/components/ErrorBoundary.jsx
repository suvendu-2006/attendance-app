import { Component } from 'react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Application error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '100vh', padding: '2rem',
          background: '#0f172a', color: '#e2e8f0', fontFamily: 'Inter, system-ui, sans-serif',
          textAlign: 'center'
        }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: '#f87171' }}>Something went wrong</h1>
          <p style={{ color: '#94a3b8', marginBottom: '1.5rem' }}>An unexpected error occurred. Please refresh the page.</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.75rem 1.5rem', borderRadius: '0.5rem',
              background: '#3b82f6', color: 'white', border: 'none',
              cursor: 'pointer', fontSize: '1rem'
            }}
          >
            Refresh Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
