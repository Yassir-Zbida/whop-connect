import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, IconPaths } from '../components/Icon';
import { getCompanies, createCompany, createTransfer, getSettings } from '../api';
import { useToast } from '../context/ToastContext';
import { logSuccess, logError } from '../utils/logger';

type Company = {
  id: string;
  title?: string;
  owner_user?: { username?: string };
};

export default function ConnectedAccounts() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [whopConfigured, setWhopConfigured] = useState<boolean | null>(null);
  const [enrollEmail, setEnrollEmail] = useState('');
  const [enrollTitle, setEnrollTitle] = useState('');
  const [enrollInternalId, setEnrollInternalId] = useState('');
  const [enrollTier, setEnrollTier] = useState('');
  const [enrollMsg, setEnrollMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [enrollWarning, setEnrollWarning] = useState<string | null>(null);
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [destId, setDestId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('usd');
  const [orderId, setOrderId] = useState('');
  const [transferMsg, setTransferMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [transferLoading, setTransferLoading] = useState(false);
  const { showToast } = useToast();

  const loadCompanies = () => {
    setLoading(true);
    Promise.all([getCompanies(), getSettings()])
      .then(([companiesRes, settings]) => {
        setCompanies(companiesRes?.data || []);
        setWhopConfigured(Boolean(settings?.whopApiKeySet && settings?.whopCompanyIdSet));
      })
      .catch(() => {
        setCompanies([]);
        setWhopConfigured(false);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadCompanies();
  }, []);

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnrollMsg(null);
    setEnrollWarning(null);
    if (!enrollEmail.trim() || !enrollTitle.trim()) {
      const text = 'Email and display name are required.';
      setEnrollMsg({ text, error: true });
      logError('Create company', text);
      showToast(text, 'error');
      return;
    }
    setEnrollLoading(true);
    try {
      const res = await createCompany({
        email: enrollEmail.trim(),
        title: enrollTitle.trim(),
        ...(enrollInternalId.trim() && { internal_user_id: enrollInternalId.trim() }),
        ...(enrollTier.trim() && { seller_tier: enrollTier.trim() }),
      });
      const text = `Connected account created. ID: ${res.id}`;
      setEnrollMsg({ text, error: false });
      if (res.warning) {
        setEnrollWarning(res.warning);
        logError('Create company', res.warning, { companyId: res.id, reserve: true });
        showToast('Account created, but Whop reserve detected — see warning below.', 'error');
      } else {
        logSuccess('Create company', text, { companyId: res.id });
        showToast(text);
      }
      setDestId(res.id);
      setEnrollEmail('');
      setEnrollTitle('');
      setEnrollInternalId('');
      setEnrollTier('');
      loadCompanies();
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Request failed';
      setEnrollMsg({ text, error: true });
      logError('Create company', text);
      showToast(text, 'error');
    } finally {
      setEnrollLoading(false);
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setTransferMsg(null);
    const num = parseFloat(amount);
    if (!destId.trim() || !Number.isFinite(num) || num <= 0) {
      const text = 'Destination ID and a valid amount are required.';
      setTransferMsg({ text, error: true });
      logError('Transfer', text);
      showToast(text, 'error');
      return;
    }
    setTransferLoading(true);
    try {
      const res = await createTransfer({
        destination_id: destId.trim(),
        amount: num,
        currency: currency || 'usd',
        ...(orderId.trim() && { metadata: { order_id: orderId.trim() } }),
      });
      const text = `Transfer created. ID: ${res.id}`;
      setTransferMsg({ text, error: false });
      logSuccess('Transfer', text, { transferId: res.id, amount: num, destination_id: destId.trim() });
      showToast(text);
      setAmount('');
      setOrderId('');
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Request failed';
      setTransferMsg({ text, error: true });
      logError('Transfer', text);
      showToast(text, 'error');
    } finally {
      setTransferLoading(false);
    }
  };

  return (
    <main className="main">
        <div className="topbar">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span className="topbar-title">Connected accounts</span>
            <span className="topbar-sub">· Enroll & send funds</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={loadCompanies}
              style={{ gap: 6 }}
              disabled={loading}
            >
              <Icon d={IconPaths.refresh} size={12} />
              Refresh
            </button>
          </div>
        </div>

        <div className="content">
          {whopConfigured === false && !loading && (
            <div
              className="card"
              style={{
                marginBottom: 20,
                borderColor: 'var(--accent-border)',
                background: 'var(--accent-dim)',
              }}
            >
              <div className="card-body hidden">
                <p style={{ marginBottom: 12, color: 'var(--text)' }}>
                  <strong>Setup required.</strong> Add your Whop API key and Company ID in Settings before you can add connected accounts or send funds.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => navigate('/settings')}
                >
                  Go to Settings
                </button>
              </div>
            </div>
          )}
          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon d={IconPaths.users} size={14} />
                <span className="card-title">Connected accounts</span>
                <span
                  style={{
                    background: 'var(--surface-3)',
                    border: '1px solid var(--border)',
                    borderRadius: 99,
                    padding: '3px 10px',
                    fontSize: 14,
                    color: 'var(--text-2)',
                  }}
                >
                  {companies.length}
                </span>
              </div>
              <button
                className="btn btn-primary btn-sm"
                style={{ gap: 6 }}
                onClick={() =>
                  document.getElementById('enroll-section')?.scrollIntoView({ behavior: 'smooth' })
                }
              >
                <Icon d={IconPaths.plus} size={12} />
                Enroll new
              </button>
            </div>

            <div
              className="account-row account-row-header"
              style={{
                padding: '8px 20px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--surface-2)',
                marginBottom: 0,
              }}
            >
              <div style={{ flex: 2, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Account
              </div>
              <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Status
              </div>
              <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Actions
              </div>
            </div>

            {loading ? (
              <div className="empty-state">
                <p>Loading…</p>
              </div>
            ) : companies.length === 0 ? (
              <div className="empty-state">
                <p>No connected accounts yet</p>
                <p>Create one below to get started</p>
              </div>
            ) : (
              companies.map((c) => (
                <div key={c.id} className="account-row">
                  <div style={{ flex: 2 }}>
                    <div className="account-name">{c.title || 'Untitled'}</div>
                    <div className="account-id monospace">{c.id}</div>
                    {c.owner_user?.username && (
                      <div className="account-username">@{c.owner_user.username}</div>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <span className="badge badge-active">
                      <span className="badge-dot" />
                      Active
                    </span>
                  </div>
                  <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-orange-ghost btn-sm"
                      style={{ gap: 6 }}
                      onClick={() => {
                        setDestId(c.id);
                        document
                          .getElementById('transfer-section')
                          ?.scrollIntoView({ behavior: 'smooth' });
                      }}
                    >
                      <Icon d={IconPaths.send} size={11} />
                      Send funds
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="card" id="enroll-section">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon d={IconPaths.plus} size={14} />
                <span className="card-title">Enroll connected account</span>
              </div>
            </div>
            <div className="card-body">
              <p className="card-desc">
                Create a Company for each merchant. They can accept payments and receive payouts.
              </p>
              <form onSubmit={handleEnroll}>
                <div className="form-grid-2">
                  <div className="field">
                    <label className="field-label">Email *</label>
                    <input
                      className="field-input"
                      placeholder="merchant@example.com"
                      value={enrollEmail}
                      onChange={(e) => setEnrollEmail(e.target.value)}
                      disabled={enrollLoading}
                    />
                  </div>
                  <div className="field">
                    <label className="field-label">Display name *</label>
                    <input
                      className="field-input"
                      placeholder="Acme Merchant Store"
                      value={enrollTitle}
                      onChange={(e) => setEnrollTitle(e.target.value)}
                      disabled={enrollLoading}
                    />
                  </div>
                </div>
                <div className="form-grid-2">
                  <div className="field">
                    <label className="field-label">Internal user ID</label>
                    <input
                      className="field-input monospace"
                      placeholder="user_12345"
                      value={enrollInternalId}
                      onChange={(e) => setEnrollInternalId(e.target.value)}
                      disabled={enrollLoading}
                    />
                  </div>
                  <div className="field">
                    <label className="field-label">Seller tier</label>
                    <input
                      className="field-input"
                      placeholder="gold"
                      value={enrollTier}
                      onChange={(e) => setEnrollTier(e.target.value)}
                      disabled={enrollLoading}
                    />
                  </div>
                </div>
                {enrollMsg && (
                  <div className={`alert ${enrollMsg.error ? 'alert-error' : 'alert-success'}`}>
                    {enrollMsg.text}
                  </div>
                )}
                {enrollWarning && (
                  <div className="alert alert-warning">{enrollWarning}</div>
                )}
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={enrollLoading}
                  style={{ gap: 7 }}
                >
                  <Icon d={IconPaths.plus} size={13} />
                  {enrollLoading ? 'Creating…' : 'Create connected account'}
                </button>
              </form>
            </div>
          </div>

          <div className="card" id="transfer-section">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon d={IconPaths.send} size={14} />
                <span className="card-title">Send funds</span>
              </div>
            </div>
            <div className="card-body">
              <p className="card-desc">
                Transfer from your platform balance to a connected account.
              </p>
              <form onSubmit={handleTransfer}>
                <div className="field" style={{ marginBottom: 14 }}>
                  <label className="field-label">Destination company ID *</label>
                  <input
                    className="field-input monospace"
                    placeholder="biz_xxxxxxxxxxxxx"
                    value={destId}
                    onChange={(e) => setDestId(e.target.value)}
                    disabled={transferLoading}
                  />
                </div>
                <div className="form-grid-3">
                  <div className="field">
                    <label className="field-label">Amount *</label>
                    <input
                      className="field-input"
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="90.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      disabled={transferLoading}
                    />
                  </div>
                  <div className="field">
                    <label className="field-label">Currency</label>
                    <select
                      className="select-native"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      disabled={transferLoading}
                    >
                      <option value="usd">USD — US Dollar</option>
                      <option value="eur">EUR — Euro</option>
                      <option value="gbp">GBP — British Pound</option>
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label">Order ID (optional)</label>
                    <input
                      className="field-input monospace"
                      placeholder="order_12345"
                      value={orderId}
                      onChange={(e) => setOrderId(e.target.value)}
                      disabled={transferLoading}
                    />
                  </div>
                </div>
                {transferMsg && (
                  <div className={`alert ${transferMsg.error ? 'alert-error' : 'alert-success'}`}>
                    {transferMsg.text}
                  </div>
                )}
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={transferLoading}
                  style={{ gap: 7 }}
                >
                  <Icon d={IconPaths.send} size={13} />
                  {transferLoading ? 'Sending…' : 'Send funds'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>
  );
}
