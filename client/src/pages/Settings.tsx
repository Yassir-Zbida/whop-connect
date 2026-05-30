import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Icon, IconPaths } from '../components/Icon';
import { getSettings, updateSettings, pollPaymentsNow, processPaymentQueueNow } from '../api';
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
  const [pollEnabled, setPollEnabled] = useState(true);
  const [pollTickMs, setPollTickMs] = useState('60000');
  const [pollParallel, setPollParallel] = useState('5');
  const [workerEnabled, setWorkerEnabled] = useState(true);
  const [workerConcurrency, setWorkerConcurrency] = useState('5');
  const [workerPending, setWorkerPending] = useState(0);
  const [workerProcessing, setWorkerProcessing] = useState(0);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [pollsTotal, setPollsTotal] = useState(0);
  const [lastPollAt, setLastPollAt] = useState<string | null>(null);
  const [lastPollError, setLastPollError] = useState<string | null>(null);
  const [pollingNow, setPollingNow] = useState(false);
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
        setPollEnabled(s.pollEnabled !== false);
        setPollTickMs(String(s.pollTickMs ?? (s.pollIntervalSeconds ?? 60) * 1000));
        setPollParallel(String(s.pollParallel ?? 5));
        setWorkerEnabled(s.workerEnabled !== false);
        setWorkerConcurrency(String(s.workerConcurrency ?? 5));
        setWorkerPending(s.workerQueue?.pending ?? 0);
        setWorkerProcessing(s.workerQueue?.processing ?? 0);
        setPollsTotal(s.pollsTotal ?? 0);
        setLastPollAt(s.lastPollAt ?? null);
        setLastPollError(s.lastPollError ?? null);
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
    const tickNum = parseInt(pollTickMs, 10);
    const parallelNum = parseInt(pollParallel, 10);
    const workerConcurrencyNum = parseInt(workerConcurrency, 10);
    if (
      pollTickMs.trim() !== '' &&
      (!Number.isFinite(tickNum) || tickNum < 1000 || tickNum > 86400000)
    ) {
      setMsgWhop({ text: 'Poll interval must be between 1000 and 86400000 milliseconds.', error: true });
      return;
    }
    if (
      pollParallel.trim() !== '' &&
      (!Number.isFinite(parallelNum) || parallelNum < 1 || parallelNum > 50)
    ) {
      setMsgWhop({ text: 'Max parallel enqueues must be between 1 and 50.', error: true });
      return;
    }
    if (
      workerConcurrency.trim() !== '' &&
      (!Number.isFinite(workerConcurrencyNum) || workerConcurrencyNum < 1 || workerConcurrencyNum > 50)
    ) {
      setMsgWhop({ text: 'Max parallel worker jobs must be between 1 and 50.', error: true });
      return;
    }
    setSavingWhop(true);
    try {
      await updateSettings({
        ...(whopApiKey.trim() && { whopApiKey: whopApiKey.trim() }),
        ...(whopCompanyId.trim() && { whopCompanyId: whopCompanyId.trim() }),
        ...(whopWebhookSecret.trim() && { whopWebhookSecret: whopWebhookSecret.trim() }),
        ...(platformCommissionPct.trim() !== '' && { platformCommissionPct: commissionNum }),
        pollEnabled,
        pollTickMs: tickNum,
        pollParallel: parallelNum,
        workerEnabled,
        workerConcurrency: workerConcurrencyNum,
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
        setPollEnabled(s.pollEnabled !== false);
        setPollTickMs(String(s.pollTickMs ?? (s.pollIntervalSeconds ?? 60) * 1000));
        setPollParallel(String(s.pollParallel ?? 5));
        setWorkerEnabled(s.workerEnabled !== false);
        setWorkerConcurrency(String(s.workerConcurrency ?? 5));
        setWorkerPending(s.workerQueue?.pending ?? 0);
        setWorkerProcessing(s.workerQueue?.processing ?? 0);
        setPollsTotal(s.pollsTotal ?? 0);
        setLastPollAt(s.lastPollAt ?? null);
        setLastPollError(s.lastPollError ?? null);
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

  const handlePollNow = async () => {
    setPollingNow(true);
    setMsgWhop(null);
    try {
      const res = await pollPaymentsNow();
      const text =
        res.message ||
        (res.firstPoll
          ? 'First poll recorded. Future polls will process new payments.'
          : `Queued ${res.queued}, skipped ${res.skipped}.`);
      setMsgWhop({ text, error: !res.ok && (res.errors?.length ?? 0) > 0 });
      showToast(text, !res.ok && (res.errors?.length ?? 0) > 0 ? 'error' : 'success');
      if (res.ok) logSuccess('Payment poll', text, res);
      else logError('Payment poll', text, res);
      const s = await getSettings();
      setPollsTotal(s.pollsTotal ?? 0);
      setLastPollAt(s.lastPollAt ?? null);
      setLastPollError(s.lastPollError ?? null);
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Poll failed';
      setMsgWhop({ text, error: true });
      showToast(text, 'error');
      logError('Payment poll', text);
    } finally {
      setPollingNow(false);
    }
  };

  const handleProcessQueue = async () => {
    setProcessingQueue(true);
    setMsgWhop(null);
    try {
      const res = await processPaymentQueueNow();
      const text = res.message || `Processed ${res.processed} payment(s).`;
      setMsgWhop({ text, error: !res.ok && (res.failed ?? 0) > 0 });
      showToast(text, !res.ok && (res.failed ?? 0) > 0 ? 'error' : 'success');
      if (res.ok) logSuccess('Payment worker', text, res);
      else logError('Payment worker', text, res);
      const s = await getSettings();
      setWorkerPending(s.workerQueue?.pending ?? 0);
      setWorkerProcessing(s.workerQueue?.processing ?? 0);
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Process queue failed';
      setMsgWhop({ text, error: true });
      showToast(text, 'error');
      logError('Payment worker', text);
    } finally {
      setProcessingQueue(false);
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
              <div
                className="card"
                style={{
                  marginTop: 16,
                  padding: 16,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Payment poller</div>
                <p className="card-desc" style={{ marginTop: 0, marginBottom: 14 }}>
                  Polls Whop for new paid payments when auto-split or auto-transfer is enabled. Manual &quot;Poll now&quot; works even when the background poller is off.
                </p>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 14,
                    cursor: 'pointer',
                    fontSize: 14,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={pollEnabled}
                    onChange={(e) => setPollEnabled(e.target.checked)}
                    disabled={savingWhop}
                  />
                  <span>
                    <strong>Enable background poller</strong>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', fontWeight: 400 }}>
                      Automatically check Whop for new payments on a schedule.
                    </span>
                  </span>
                </label>
                <div className="field">
                  <label className="field-label">Poll interval (milliseconds)</label>
                  <input
                    className="field-input"
                    type="number"
                    min="1000"
                    max="86400000"
                    step="1000"
                    placeholder="60000"
                    value={pollTickMs}
                    onChange={(e) => setPollTickMs(e.target.value)}
                    disabled={savingWhop}
                  />
                  <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
                    Minimum time between polls for your account (default 60000 = 60 seconds).
                  </p>
                </div>
                <div className="field">
                  <label className="field-label">Max parallel enqueues per poll</label>
                  <input
                    className="field-input"
                    type="number"
                    min="1"
                    max="50"
                    step="1"
                    placeholder="5"
                    value={pollParallel}
                    onChange={(e) => setPollParallel(e.target.value)}
                    disabled={savingWhop}
                  />
                  <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
                    How many payments to queue at once per poll cycle (default 5).
                  </p>
                </div>
              </div>
              <div
                style={{
                  marginTop: 16,
                  paddingTop: 16,
                  borderTop: '1px solid var(--border)',
                }}
              >
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>
                  Payment worker
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>
                  Processes webhooks and polled payments in the background (auto-split / auto-transfer). When disabled, payments stay queued until you click Process queue.
                </p>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    marginBottom: 14,
                    cursor: 'pointer',
                    fontSize: 14,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={workerEnabled}
                    onChange={(e) => setWorkerEnabled(e.target.checked)}
                    disabled={savingWhop}
                  />
                  <span>
                    <strong>Enable background worker</strong>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', fontWeight: 400 }}>
                      Automatically process queued payments for your account.
                    </span>
                  </span>
                </label>
                <div className="field">
                  <label className="field-label">Max parallel jobs</label>
                  <input
                    className="field-input"
                    type="number"
                    min="1"
                    max="50"
                    step="1"
                    placeholder="5"
                    value={workerConcurrency}
                    onChange={(e) => setWorkerConcurrency(e.target.value)}
                    disabled={savingWhop}
                  />
                  <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
                    How many queued payments to process at once for your account (default 5).
                  </p>
                </div>
              </div>
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handlePollNow}
                  disabled={pollingNow || savingWhop}
                  style={{ gap: 6 }}
                >
                  <Icon d={IconPaths.refresh} size={12} />
                  {pollingNow ? 'Polling…' : 'Poll now'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleProcessQueue}
                  disabled={processingQueue || savingWhop}
                  style={{ gap: 6 }}
                >
                  <Icon d={IconPaths.refresh} size={12} />
                  {processingQueue ? 'Processing…' : 'Process queue'}
                </button>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  {lastPollAt ? (
                    <>
                      Last poll: {new Date(lastPollAt).toLocaleString()} · {pollsTotal} total
                      {pollEnabled ? '' : ' · background poller off'}
                    </>
                  ) : (
                    <>No poll yet — first poll records start time only</>
                  )}
                  {(workerPending > 0 || workerProcessing > 0) && (
                    <span style={{ display: 'block', marginTop: 4 }}>
                      Queue: {workerPending} pending
                      {workerProcessing > 0 ? ` · ${workerProcessing} processing` : ''}
                      {workerEnabled ? '' : ' · background worker off'}
                    </span>
                  )}
                  {!workerPending && !workerProcessing && !workerEnabled && (
                    <span style={{ display: 'block', marginTop: 4 }}>Background worker off</span>
                  )}
                  {lastPollError && (
                    <span style={{ color: 'var(--danger)', display: 'block', marginTop: 4 }}>
                      Last error: {lastPollError}
                    </span>
                  )}
                </div>
              </div>
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
