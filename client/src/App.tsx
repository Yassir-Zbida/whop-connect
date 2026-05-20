import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { fetchCsrfToken, getMe, logout } from './api';
import { useToast } from './context/ToastContext';
import { logSuccess, logInfo, logError } from './utils/logger';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ConnectedAccounts from './pages/ConnectedAccounts';
import Transactions from './pages/Transactions';
import Products from './pages/Products';
import Members from './pages/Members';
import AutoSplit from './pages/AutoSplit';
import AutoTransfer from './pages/AutoTransfer';
import SimpleTransfer from './pages/SimpleTransfer';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import Admin from './pages/Admin';
import Analytics from './pages/Analytics';
import SystemHealth from './pages/SystemHealth';
import DashboardLayout from './components/DashboardLayout';

export default function App() {
  const [user, setUser] = useState<{ id: number; email: string; role?: 'user' | 'admin' } | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { showToast } = useToast();

  const refreshUser = () => {
    return getMe()
      .then((data) => {
        const u = data?.user ?? null;
        if (u && (u.role !== 'admin' && u.role !== 'user')) {
          (u as { role: 'user' | 'admin' }).role = 'user';
        }
        setUser(u);
        return u;
      })
      .catch(() => {
        setUser(null);
        return null;
      });
  };

  useEffect(() => {
    logInfo('App', 'Application started');
    fetchCsrfToken()
      .catch((err) => {
        const msg =
          err instanceof Error ? err.message : 'Could not load security token. Refresh the page.';
        logError('Security', msg);
        showToast(msg, 'error');
      })
      .finally(() => refreshUser().finally(() => setLoading(false)));
  }, [showToast]);

  const onLogin = (userFromResponse?: { id: number; email: string; role?: 'user' | 'admin' } | null) => {
    if (userFromResponse) {
      const role: 'user' | 'admin' = userFromResponse.role === 'admin' ? 'admin' : 'user';
      const u: { id: number; email: string; role?: 'user' | 'admin' } = { ...userFromResponse, role };
      flushSync(() => setUser(u));
      navigate(role === 'admin' ? '/analytics' : '/connected-accounts', { replace: true });
      return;
    }
    refreshUser().then((u) => {
      if (u) navigate(u.role === 'admin' ? '/analytics' : '/connected-accounts', { replace: true });
    });
  };

  const onLogout = async () => {
    try {
      await logout();
    } catch {
      // Session may already be invalid; still clear local state
    }
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
        element={user ? <Navigate to={user.role === 'admin' ? '/analytics' : '/connected-accounts'} replace /> : <Login onLogin={onLogin} />}
      />
      <Route
        path="/signup"
        element={user ? <Navigate to={user.role === 'admin' ? '/analytics' : '/connected-accounts'} replace /> : <Signup onSignup={onLogin} />}
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
        <Route index element={<Navigate to={user?.role === 'admin' ? '/analytics' : '/connected-accounts'} replace />} />
        <Route path="analytics" element={user?.role === 'admin' ? <Analytics /> : <Navigate to="/" replace />} />
        <Route path="system-health" element={user?.role === 'admin' ? <SystemHealth /> : <Navigate to="/" replace />} />
        <Route path="connected-accounts" element={user?.role === 'admin' ? <Navigate to="/analytics" replace /> : <ConnectedAccounts />} />
        <Route path="transactions" element={user?.role === 'admin' ? <Navigate to="/analytics" replace /> : <Transactions />} />
        <Route path="transfer-funds" element={user?.role === 'admin' ? <Navigate to="/analytics" replace /> : <SimpleTransfer />} />
        <Route path="auto-split" element={user?.role === 'admin' ? <Navigate to="/analytics" replace /> : <AutoSplit />} />
        <Route path="auto-transfer" element={user?.role === 'admin' ? <Navigate to="/analytics" replace /> : <AutoTransfer />} />
        <Route path="products" element={user?.role === 'admin' ? <Navigate to="/analytics" replace /> : <Products />} />
        <Route path="members" element={user?.role === 'admin' ? <Navigate to="/analytics" replace /> : <Members />} />
        <Route path="logs" element={user?.role === 'admin' ? <Logs /> : <Navigate to="/" replace />} />
        <Route path="settings" element={<Settings />} />
        <Route path="admin" element={user?.role === 'admin' ? <Admin /> : <Navigate to="/" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
