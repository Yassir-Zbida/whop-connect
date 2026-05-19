import { useState } from 'react';
import { Link } from 'react-router-dom';
import { register } from '../api';
import { useToast } from '../context/ToastContext';
import { logSuccess, logError } from '../utils/logger';
import { Icon, IconPaths } from '../components/Icon';

type Props = { onSignup: (user?: { id: number; email: string } | null) => void };

export default function Signup({ onSignup }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const eTrim = email.trim().toLowerCase();
    if (!eTrim || !password) {
      const msg = 'Please enter email and password.';
      setError(msg);
      showToast(msg, 'error');
      return;
    }
    if (password.length < 12) {
      const msg = 'Password must be at least 12 characters.';
      setError(msg);
      showToast(msg, 'error');
      return;
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      const msg = 'Password must include at least one letter and one number.';
      setError(msg);
      showToast(msg, 'error');
      return;
    }
    if (password !== confirmPassword) {
      const msg = 'Passwords do not match.';
      setError(msg);
      showToast(msg, 'error');
      return;
    }
    setLoading(true);
    try {
      const res = await register(eTrim, password);
      logSuccess('Signup', 'Account created');
      showToast('Account created. Signing you in…');
      onSignup(res?.user ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign up failed. Email may already be in use.';
      setError(msg);
      logError('Signup', msg);
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
            <div style={{ fontSize: 15, color: 'var(--text-2)' }}>Create your account</div>
          </div>
        </div>
        <div className="login-body">
          {error && <div className="alert alert-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label className="field-label">Email</label>
              <input
                className="field-input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                disabled={loading}
              />
            </div>
            <div className="field">
              <label className="field-label">Password</label>
              <div className="password-input-wrap">
                <input
                  className="field-input"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="At least 12 characters, letter + number"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  <Icon d={showPassword ? IconPaths.eyeOff : IconPaths.eye} size={18} />
                </button>
              </div>
            </div>
            <div className="field" style={{ marginBottom: 20 }}>
              <label className="field-label">Confirm password</label>
              <div className="password-input-wrap">
                <input
                  className="field-input"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowConfirmPassword((s) => !s)}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  <Icon d={showConfirmPassword ? IconPaths.eyeOff : IconPaths.eye} size={18} />
                </button>
              </div>
            </div>
            <button
              className="btn btn-primary btn-full"
              type="submit"
              disabled={loading}
              style={{ padding: '10px 16px', fontSize: 14 }}
            >
              {loading ? 'Creating account…' : 'Sign up'}
            </button>
          </form>
          <p style={{ marginTop: 16, fontSize: 14, color: 'var(--text-2)' }}>
            Already have an account? <Link to="/login" className="login-signup-link">Login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
