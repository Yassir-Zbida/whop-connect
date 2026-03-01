import { useState, useEffect } from 'react';
import { login } from '../api';
import { useToast } from '../context/ToastContext';
import { logSuccess, logError } from '../utils/logger';

type Props = { onLogin: () => void };

export default function Login({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    fetch('/api/debug-env', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        console.log('[Whop Connect] Server env debug:', data);
        if (!data.adminPasswordSet) {
          console.warn('[Whop Connect] ADMIN_PASSWORD is not set on server — login will always return 401.');
        }
      })
      .catch((err) => console.warn('[Whop Connect] Could not fetch debug-env:', err));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      const msg = 'Please enter your username and password.';
      setError(msg);
      logError('Login', msg);
      showToast(msg, 'error');
      return;
    }
    setLoading(true);
    try {
      await login(username.trim(), password);
      logSuccess('Login', 'Signed in successfully');
      showToast('Signed in successfully');
      onLogin();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid username or password.';
      setError(msg);
      logError('Login', msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-header">
          <img src="/whop-icon.svg" alt="Whop" className="logo-mark logo-img" />
          <div>
            <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: '-0.02em' }}>Whop Connect</div>
            <div style={{ fontSize: 15, color: 'var(--text-2)' }}>Sign in to continue</div>
          </div>
        </div>
        <div className="login-body">
          {error && <div className="alert alert-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label className="field-label">Username</label>
              <input
                className="field-input"
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                disabled={loading}
              />
            </div>
            <div className="field" style={{ marginBottom: 20 }}>
              <label className="field-label">Password</label>
              <input
                className="field-input"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={loading}
              />
            </div>
            <button
              className="btn btn-primary btn-full"
              type="submit"
              disabled={loading}
              style={{ padding: '10px 16px', fontSize: 14 }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
