const InAppBrowserWarning = () => {
  return (
    <div role="alert" aria-live="assertive" style={styles.container}>
      <div style={styles.card}>
        <div style={styles.icon}>⚠️</div>
        <h1 style={styles.title}>Action Required</h1>
        <p style={styles.text}>
          This app cannot run inside an in-app browser (like WhatsApp or Instagram).
        </p>
        <div style={styles.instructionBox}>
          <p style={styles.instructionText}>
            Please tap the <strong>three dots</strong> in the top right corner and select:
            <br /><br />
            <strong>"Open in Chrome"</strong> or <strong>"Open in Safari"</strong>
          </p>
        </div>
        <a
          href={window.location.href}
          rel="noopener noreferrer"
          style={{ display: 'inline-block', marginTop: 16, padding: '0.6rem 1.2rem', background: '#3b82f6', color: 'white', borderRadius: 8, textDecoration: 'none' }}
        >
          Open in default browser
        </a>
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    padding: '20px',
    fontFamily: 'Inter, system-ui, sans-serif'
  },
  card: {
    backgroundColor: '#1e293b',
    padding: '40px 30px',
    borderRadius: '16px',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
    maxWidth: '400px',
    width: '100%',
    textAlign: 'center',
    border: '1px solid #334155'
  },
  icon: {
    fontSize: '48px',
    marginBottom: '20px'
  },
  title: {
    fontSize: '24px',
    fontWeight: '700',
    marginBottom: '16px',
    color: '#f1f5f9'
  },
  text: {
    fontSize: '16px',
    lineHeight: '1.5',
    color: '#cbd5e1',
    marginBottom: '24px'
  },
  instructionBox: {
    backgroundColor: '#0f172a',
    padding: '20px',
    borderRadius: '8px',
    border: '1px dashed #475569'
  },
  instructionText: {
    fontSize: '15px',
    color: '#e2e8f0',
    lineHeight: '1.6',
    margin: 0
  }
};

export default InAppBrowserWarning;
