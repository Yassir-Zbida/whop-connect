import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { getMe } from './api';
import { useToast } from './context/ToastContext';
import { logSuccess, logInfo } from './utils/logger';
import Login from './pages/Login';
import ConnectedAccounts from './pages/ConnectedAccounts';
import Transactions from './pages/Transactions';
import Products from './pages/Products';
import Members from './pages/Members';
import AutoSplit from './pages/AutoSplit';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import DashboardLayout from './components/DashboardLayout';

export default function App() {
  const [user, setUser] = useState<{ username: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { showToast } = useToast();

  useEffect(() => {
    logInfo('App', 'Application started');
    getMe()
      .then((data) => {
        setUser(data?.user ?? null);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const onLogin = () => {
    setUser({ username: 'admin' });
    navigate('/connected-accounts', { replace: true });
  };

  const onLogout = () => {
    logSuccess('Logout', 'Signed out');
    showToast('Signed out');
    setUser(null);
    navigate('/login', { replace: true });
  };

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          background: 'var(--bg)',
          color: 'var(--text)',
          fontSize: 16,
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/connected-accounts" replace /> : <Login onLogin={onLogin} />}
      />
      <Route
        path="/"
        element={
          user ? (
            <DashboardLayout user={user} onLogout={onLogout} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route index element={<Navigate to="/connected-accounts" replace />} />
        <Route path="connected-accounts" element={<ConnectedAccounts />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="auto-split" element={<AutoSplit />} />
        <Route path="products" element={<Products />} />
        <Route path="members" element={<Members />} />
        <Route path="logs" element={<Logs />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
