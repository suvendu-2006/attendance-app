with open('frontend/src/pages/TeacherDashboard.jsx', 'r') as f:
    content = f.read()

ui_buttons = """
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
"""

content = content.replace("""
      {showAdminPanel && isAdmin && (
        <div className="card" style={{ marginBottom: '20px', border: '1px solid #ef4444' }}>
          <h2 style={{ marginBottom: '16px', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444' }}>
            <Users size={24} />
            Student Management (Admin)
          </h2>
""", ui_buttons)

with open('frontend/src/pages/TeacherDashboard.jsx', 'w') as f:
    f.write(content)
