import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Icon, IconPaths } from '../components/Icon';
import { getSettings, updateSettings } from '../api';
import { useToast } from '../context/ToastContext';
import { logSuccess, logError } from '../utils/logger';

type LayoutContext = { user: { id: number; email: string; role?: 'user' | 'admin' } };

export default function Settings() {
  const { user } = useOutletContext<LayoutContext>();
  const isAdmin = user?.role === 'admin';
  const [loading, setLoading] = useState(true);
  const [savingWhop, setSavingWhop] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [whopApiKey, setWhopApiKey] = useState('');
  const [whopCompanyId, setWhopCompanyId] = useState('');
  const [whopWebhookSecret, setWhopWebhookSecret] = useState('');
  const [webhookSecretSet, setWebhookSecretSet] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [maskedApiKey, setMaskedApiKey] = useState<string | null>(null);
  const [adminPasswordSet, setAdminPasswordSet] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [platformCommissionPct, setPlatformCommissionPct] = useState('1');
  const [cachedFeePct, setCachedFeePct] = useState<number | null>(null);
  const [msgWhop, setMsgWhop] = useState<{ text: string; error: boolean } | null>(null);
  const [msgPassword, setMsgPassword] = useState<{ text: string; error: boolean } | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    getSettings()
      .then((s) => {
        setMaskedApiKey(s.whopApiKeyMasked);
        setWhopCompanyId(s.whopCompanyId || '');
        setAdminPasswordSet(s.adminPasswordSet);
        setWebhookUrl(s.webhookUrl ?? null);
        setWebhookSecretSet(Boolean(s.whopWebhookSecretSet));
        setPlatformCommissionPct(String(s.platformCommissionPct ?? 1));
        setCachedFeePct(s.cachedFeePct ?? null);
      })
      .catch(() => setMsgWhop({ text: 'Failed to load settings', error: true }))
      .finally(() => setLoading(false));
  }, []);

  const handleSaveWhop = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsgWhop(null);
    const commissionNum = parseFloat(platformCommissionPct);
    if (
      platformCommissionPct.trim() !== '' &&
      (!Number.isFinite(commissionNum) || commissionNum < 0 || commissionNum > 100)
    ) {
      setMsgWhop({ text: 'Platform commission must be between 0 and 100.', error: true });
      return;
    }
    setSavingWhop(true);
    try {
      await updateSettings({
        ...(whopApiKey.trim() && { whopApiKey: whopApiKey.trim() }),
        ...(whopCompanyId.trim() && { whopCompanyId: whopCompanyId.trim() }),
        ...(whopWebhookSecret.trim() && { whopWebhookSecret: whopWebhookSecret.trim() }),
        ...(platformCommissionPct.trim() !== '' && { platformCommissionPct: commissionNum }),
      });
      logSuccess('Settings', 'Whop API & Company saved');
      showToast('Whop settings saved');
      setMsgWhop({ text: 'Saved.', error: false });
      window.dispatchEvent(new CustomEvent('whop-settings-saved'));
      setWhopApiKey('');
      setWhopWebhookSecret('');
      getSettings().then((s) => {
        setMaskedApiKey(s.whopApiKeyMasked);
        setWhopCompanyId(s.whopCompanyId || '');
        setWebhookUrl(s.webhookUrl ?? null);
        setWebhookSecretSet(Boolean(s.whopWebhookSecretSet));
        setPlatformCommissionPct(String(s.platformCommissionPct ?? 1));
        setCachedFeePct(s.cachedFeePct ?? null);
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
    if (newPassword.length < 12) {
      setMsgPassword({ text: 'New password must be at least 12 characters.', error: true });
      showToast('Password too short', 'error');
      return;
    }
    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setMsgPassword({ text: 'Password must include at least one letter and one number.', error: true });
      showToast('Password too weak', 'error');
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
          <span className="topbar-title">{isAdmin ? 'Admin settings' : 'Settings'}</span>
          <span className="topbar-sub">
            {isAdmin ? '· Profile, optional Whop API & password' : '· Whop API, company ID & dashboard password'}
          </span>
        </div>
      </div>

      <div className="content settings-grid">
        {isAdmin && (
          <div
            className="card"
            style={{
              gridColumn: '1 / -1',
              background: 'linear-gradient(135deg, var(--accent-dim) 0%, var(--surface-2) 100%)',
              borderColor: 'var(--accent-border)',
            }}
          >
            <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: 700,
                  fontSize: 18,
                }}
              >
                A
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>{user?.email}</div>
                <span
                  style={{
                    display: 'inline-block',
                    marginTop: 4,
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    background: 'var(--accent)',
                    color: 'white',
                  }}
                >
                  Administrator
                </span>
              </div>
              <p style={{ marginLeft: 'auto', fontSize: 14, color: 'var(--text-2)', maxWidth: 360 }}>
                You have access to Analytics, Users, and Logs. Below you can change your password and optionally set Whop API for this account.
              </p>
            </div>
          </div>
        )}

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
              {isAdmin
                ? 'Optional for your admin account. Set Whop API key and Company ID if you also want to use connected accounts from this login. Leave blank to keep current value.'
                : 'Set your Whop API key and Company ID here. Both are required to add connected accounts, send funds, and use Auto-split. Leave a field blank to keep its current value.'}
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
              <div className="field">
                <label className="field-label">Whop Webhook Secret</label>
                {webhookSecretSet && !whopWebhookSecret && (
                  <p style={{ fontSize: 12, color: 'var(--success)', marginBottom: 6 }}>
                    Webhook secret is saved. Enter a new value only to replace it.
                  </p>
                )}
                <input
                  className="field-input"
                  type="password"
                  placeholder="From Whop Developer → Webhooks (required for auto-split)"
                  value={whopWebhookSecret}
                  onChange={(e) => setWhopWebhookSecret(e.target.value)}
                  autoComplete="off"
                  disabled={savingWhop}
                />
                <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
                  Copy from your Whop webhook settings. Used to verify incoming payment events.
                </p>
              </div>
              <div className="field">
                <label className="field-label">Platform commission (%)</label>
                <input
                  className="field-input"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="1"
                  value={platformCommissionPct}
                  onChange={(e) => setPlatformCommissionPct(e.target.value)}
                  disabled={savingWhop}
                />
                <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
                  Percentage kept on each transfer before Whop fees. Default 1%.
                </p>
              </div>
              {cachedFeePct != null && (
                <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 8 }}>
                  Whop transfer fee: ~{(cachedFeePct * 100).toFixed(1)}% (auto-learned from past transfers)
                </p>
              )}
              <button className="btn btn-primary" type="submit" disabled={savingWhop} style={{ marginTop: 8 }}>
                {savingWhop ? 'Saving…' : 'Save settings'}
              </button>
            </form>
            {(webhookUrl || import.meta.env?.PROD) && (
              <div className="field" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <label className="field-label">Webhook URL (for Auto-split)</label>
                <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 6 }}>
                  Use this URL in your Whop dashboard to receive payment.succeeded events.
                </p>
                {webhookUrl && !(import.meta.env?.PROD && webhookUrl.includes('localhost')) ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <code style={{ flex: 1, minWidth: 200, fontSize: 12, wordBreak: 'break-all', padding: 8, background: 'var(--bg-2)', borderRadius: 6 }}>
                      {webhookUrl}
                    </code>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: 12 }}
                      onClick={() => {
                        navigator.clipboard.writeText(webhookUrl);
                        showToast('Webhook URL copied');
                      }}
                    >
                      Copy
                    </button>
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    Set <code style={{ background: 'var(--bg-2)', padding: '2px 6px', borderRadius: 4 }}>APP_BASE_URL</code> in your server environment to your production URL (e.g. <code style={{ background: 'var(--bg-2)', padding: '2px 6px', borderRadius: 4 }}>https://yourdomain.com</code>), then refresh. The webhook URL will appear here.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Dashboard password */}
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.settings} size={14} />
              <span className="card-title">{isAdmin ? 'Admin account password' : 'Dashboard password'}</span>
            </div>
          </div>
          <div className="card-body">
            {adminPasswordSet ? (
              <p className="card-desc">
                {isAdmin
                  ? 'Change your admin account password. Enter current password and a new one below.'
                  : 'A password is set. Enter your current password and a new one below to change it.'}
              </p>
            ) : (
              <p className="card-desc">
                {isAdmin
                  ? 'Set a password for this admin account. You can change it later here.'
                  : 'Set a password for logging into this dashboard. You can change it later here.'}
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
                  placeholder="Min 12 characters, letter + number"
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
