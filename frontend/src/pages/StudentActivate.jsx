import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/api';

function StudentActivate() {
  const [rollNumber, setRollNumber] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  const handleActivate = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      const response = await apiFetch('/api/auth/student/activate', {
        method: 'POST',
        body: { roll_number: rollNumber, temp_password: tempPassword, new_password: newPassword }
      });

      if (response.ok) {
        setSuccess('Account activated successfully! Redirecting to login...');
        setTimeout(() => navigate('/student/login'), 2000);
      } else {
        const data = await response.json();
        setError(data.error || 'Activation failed');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">Activate Student Account</h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Enter the roll number and temporary password provided by your teacher.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleActivate}>
            {error && <div className="text-red-500 text-sm">{error}</div>}
            {success && <div className="text-green-500 text-sm">{success}</div>}

            <div>
              <label className="block text-sm font-medium text-gray-700">Roll Number</label>
              <input
                type="text"
                required
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                value={rollNumber}
                onChange={(e) => setRollNumber(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Temporary Password</label>
              <input
                type="password"
                required
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">New Password</label>
              <input
                type="password"
                required
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Activate Account
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default StudentActivate;
