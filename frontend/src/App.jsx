import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { isInAppBrowser } from './utils/browserDetection';
import InAppBrowserWarning from './components/InAppBrowserWarning';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import CheckIn from './pages/CheckIn';
import TeacherDashboard from './pages/TeacherDashboard';
import NotFound from './pages/NotFound';
import StudentLogin from './pages/StudentLogin';
import TeacherRegister from './pages/TeacherRegister';
import StudentActivate from './pages/StudentActivate';
import './index.css';

export default function App() {
  const [inApp, setInApp] = useState(false);

  useEffect(() => {
    setInApp(isInAppBrowser());
  }, []);

  if (inApp) return <InAppBrowserWarning />;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/student-login" element={<StudentLogin />} />
        <Route path="/student-activate" element={<StudentActivate />} />
        <Route path="/teacher-register" element={<TeacherRegister />} />
        <Route path="/check-in" element={<CheckIn />} />
        <Route path="/teacher" element={
          <ProtectedRoute>
            <TeacherDashboard />
          </ProtectedRoute>
        } />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
