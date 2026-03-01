import { useState, useEffect } from 'react';
import { Icon, IconPaths } from '../components/Icon';
import { getSettings, updateSettings } from '../api';
import { useToast } from '../context/ToastContext';
import { logSuccess, logError } from '../utils/logger';

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [savingWhop, setSavingWhop] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [whopApiKey, setWhopApiKey] = useState('');
  const [whopCompanyId, setWhopCompanyId] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [maskedApiKey, setMaskedApiKey] = useState<string | null>(null);
  const [adminPasswordSet, setAdminPasswordSet] = useState(false);
  const [msgWhop, setMsgWhop] = useState<{ text: string; error: boolean } | null>(null);
  const [msgPassword, setMsgPassword] = useState<{ text: string; error: boolean } | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    getSettings()
      .then((s) => {
        setMaskedApiKey(s.whopApiKeyMasked);
        setWhopCompanyId(s.whopCompanyId || '');
        setAdminPasswordSet(s.adminPasswordSet);
      })
      .catch(() => setMsgWhop({ text: 'Failed to load settings', error: true }))
      .finally(() => setLoading(false));
  }, []);

  const handleSaveWhop = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsgWhop(null);
    if (!whopApiKey.trim() && !whopCompanyId.trim()) {
      setMsgWhop({ text: 'Enter at least one value to save.', error: true });
      return;
    }
    setSavingWhop(true);
    try {
      await updateSettings({
        ...(whopApiKey.trim() && { whopApiKey: whopApiKey.trim() }),
        ...(whopCompanyId.trim() && { whopCompanyId: whopCompanyId.trim() }),
      });
      logSuccess('Settings', 'Whop API & Company saved');
      showToast('Whop settings saved');
      setMsgWhop({ text: 'Saved.', error: false });
      setWhopApiKey('');
      getSettings().then((s) => {
        setMaskedApiKey(s.whopApiKeyMasked);
        setWhopCompanyId(s.whopCompanyId || '');
      });
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Failed to save';
      setMsgWhop({ text, error: true });
      logError('Settings', text);
      showToast(text, 'error');
    } finally {
      setSavingWhop(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsgPassword(null);
    if (!newPassword.trim()) {
      setMsgPassword({ text: 'Enter a new password to change it.', error: true });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMsgPassword({ text: 'New password and confirmation do not match.', error: true });
      showToast('Passwords do not match', 'error');
      return;
    }
    if (newPassword.length < 6) {
      setMsgPassword({ text: 'New password must be at least 6 characters.', error: true });
      showToast('Password too short', 'error');
      return;
    }
    setSavingPassword(true);
    try {
      await updateSettings({
        currentPassword,
        newPassword: newPassword.trim(),
      });
      logSuccess('Settings', 'Dashboard password updated');
      showToast('Password saved');
      setMsgPassword({ text: 'Password updated.', error: false });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setAdminPasswordSet(true);
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Failed to save password';
      setMsgPassword({ text, error: true });
      logError('Settings', text);
      showToast(text, 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  if (loading) {
    return (
      <main className="main">
        <div className="topbar">
          <span className="topbar-title">Settings</span>
        </div>
        <div className="content">
          <div className="card">
            <div className="card-body">
              <p style={{ color: 'var(--text-2)' }}>Loading…</p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="main">
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="topbar-title">Settings</span>
          <span className="topbar-sub">· Whop API, company ID & dashboard password</span>
        </div>
      </div>

      <div className="content settings-grid">
        {/* Left: Whop API & Company */}
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.settings} size={14} />
              <span className="card-title">Whop API & Company</span>
            </div>
          </div>
          <div className="card-body">
            <p className="card-desc">
              Set your Whop API key and company ID here instead of editing .env. Leave a field blank to keep its current value.
            </p>
            {msgWhop && (
              <div
                className={msgWhop.error ? 'alert alert-error' : 'alert'}
                style={msgWhop.error ? undefined : { background: 'var(--success-bg)', color: 'var(--success)', marginBottom: 14 }}
              >
                {msgWhop.text}
              </div>
            )}
            <form onSubmit={handleSaveWhop}>
              <div className="field">
                <label className="field-label">Whop API Key</label>
                {maskedApiKey && !whopApiKey && (
                  <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 6 }}>
                    Current: <code style={{ fontSize: 12 }}>{maskedApiKey}</code>
                  </p>
                )}
                <input
                  className="field-input"
                  type="password"
                  placeholder="Enter new key to replace, or leave blank"
                  value={whopApiKey}
                  onChange={(e) => setWhopApiKey(e.target.value)}
                  autoComplete="off"
                  disabled={savingWhop}
                />
              </div>
              <div className="field">
                <label className="field-label">Whop Company ID</label>
                <input
                  className="field-input"
                  type="text"
                  placeholder="e.g. biz_xxxxxxxxxxxxx"
                  value={whopCompanyId}
                  onChange={(e) => setWhopCompanyId(e.target.value)}
                  autoComplete="off"
                  disabled={savingWhop}
                />
                <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
                  Your platform company ID from Whop Dashboard.
                </p>
              </div>
              <button className="btn btn-primary" type="submit" disabled={savingWhop} style={{ marginTop: 8 }}>
                {savingWhop ? 'Saving…' : 'Save settings'}
              </button>
            </form>
          </div>
        </div>

        {/* Right: Dashboard password */}
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.settings} size={14} />
              <span className="card-title">Dashboard password</span>
            </div>
          </div>
          <div className="card-body">
            {adminPasswordSet ? (
              <p className="card-desc">
                A password is set. Enter your current password and a new one below to change it.
              </p>
            ) : (
              <p className="card-desc">
                Set a password for logging into this dashboard. You can change it later here.
              </p>
            )}
            {msgPassword && (
              <div
                className={msgPassword.error ? 'alert alert-error' : 'alert'}
                style={msgPassword.error ? undefined : { background: 'var(--success-bg)', color: 'var(--success)', marginBottom: 14 }}
              >
                {msgPassword.text}
              </div>
            )}
            <form onSubmit={handleSavePassword}>
              <div className="field">
                <label className="field-label">Current password</label>
                <input
                  className="field-input"
                  type="password"
                  placeholder="Required when changing password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={savingPassword}
                />
              </div>
              <div className="field">
                <label className="field-label">New password</label>
                <input
                  className="field-input"
                  type="password"
                  placeholder="Min 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={savingPassword}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label">Confirm new password</label>
                <input
                  className="field-input"
                  type="password"
                  placeholder="Repeat new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={savingPassword}
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={savingPassword} style={{ marginTop: 24 }}>
                {savingPassword ? 'Saving…' : 'Save settings'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
