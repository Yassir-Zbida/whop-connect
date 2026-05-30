import { useState, useEffect } from 'react';
import { Icon, IconPaths } from '../components/Icon';
import { getSettings, createTransfer, getTransfers, type Transfer } from '../api';
import { useToast } from '../context/ToastContext';
import { logSuccess, logError } from '../utils/logger';

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  }).format(amount);
}

export default function SimpleTransfer() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('usd');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loadingTransfers, setLoadingTransfers] = useState(true);
  const { showToast } = useToast();

  const loadSettings = () => {
    getSettings()
      .then((s) => setCompanyId(s.whopCompanyId ?? null))
      .catch(() => setCompanyId(null));
  };

  const loadTransfers = () => {
    setLoadingTransfers(true);
    getTransfers()
      .then((res) => setTransfers(res.data || []))
      .catch(() => setTransfers([]))
      .finally(() => setLoadingTransfers(false));
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    loadTransfers();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const destId = destinationId.trim();
    const num = parseFloat(amount);
    if (!destId) {
      setMsg({ text: 'Enter destination (user_xxx, biz_xxx, or ldgr_xxx)', error: true });
      return;
    }
    if (!Number.isFinite(num) || num <= 0) {
      setMsg({ text: 'Enter a valid positive amount', error: true });
      return;
    }
    setMsg(null);
    setSubmitting(true);
    createTransfer({
      destination_id: destId,
      amount: num,
      currency: currency || 'usd',
      ...(notes.trim() ? { notes: notes.trim().slice(0, 50) } : {}),
    })
      .then((res) => {
        const parts = [`Transfer created. ID: ${res.id}`];
        if (res.adjusted != null && res.gross != null && res.adjusted !== res.gross) {
          parts.push(
            `Sent $${res.adjusted.toFixed(2)} (from $${res.gross.toFixed(2)} after commission and Whop fees).`
          );
        }
        const text = parts.join(' ');
        setMsg({ text, error: false });
        logSuccess('Simple transfer', text, {
          transferId: res.id,
          amount: num,
          adjusted: res.adjusted,
          destination_id: destId,
        });
        showToast(text);
        setAmount('');
        setNotes('');
        loadTransfers();
      })
      .catch((err) => {
        const text = err instanceof Error ? err.message : 'Transfer failed';
        setMsg({ text, error: true });
        logError('Simple transfer', text);
        showToast(text, 'error');
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <main className="main">
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="topbar-title">Transfer funds</span>
          <span className="topbar-sub">· Any account (user, company, or ledger)</span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={loadTransfers}
          disabled={loadingTransfers}
          style={{ gap: 6 }}
        >
          <Icon d={IconPaths.refresh} size={12} />
          {loadingTransfers ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <div className="content">
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.transfer} size={14} />
              <span className="card-title">Simple transfer</span>
            </div>
          </div>
          <div className="card-body">
            <p className="card-desc">
              Send funds from your company to any Whop account: user (<code>user_xxx</code>), company (
              <code>biz_xxx</code>), or ledger account (<code>ldgr_xxx</code>). No need for a connected account.
              Amount is debited from your balance; platform commission and Whop transfer fees are deducted automatically.
            </p>
            {!companyId ? (
              <div className="alert alert-error" style={{ marginTop: 12 }}>
                Set your Whop API key and Company ID in Settings first. Your company is the origin of the transfer.
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
                <div className="field">
                  <label className="field-label">From (your company)</label>
                  <input
                    type="text"
                    className="field-input monospace"
                    value={companyId}
                    readOnly
                    aria-readonly
                  />
                </div>
                <div className="field">
                  <label className="field-label">Destination ID *</label>
                  <input
                    id="st-destination"
                    type="text"
                    className="field-input monospace"
                    placeholder="user_xxx, biz_xxx, or ldgr_xxx"
                    value={destinationId}
                    onChange={(e) => setDestinationId(e.target.value)}
                    autoComplete="off"
                    disabled={submitting}
                  />
                </div>
                <div className="form-grid-3">
                  <div className="field">
                    <label className="field-label">Amount *</label>
                    <input
                      id="st-amount"
                      type="number"
                      className="field-input"
                      placeholder="0.00"
                      min="0.01"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      disabled={submitting}
                    />
                  </div>
                  <div className="field">
                    <label className="field-label">Currency</label>
                    <select
                      id="st-currency"
                      className="select-native"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      disabled={submitting}
                    >
                      <option value="usd">USD — US Dollar</option>
                      <option value="eur">EUR — Euro</option>
                      <option value="gbp">GBP — British Pound</option>
                      <option value="sgd">SGD — Singapore Dollar</option>
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label">Notes (optional)</label>
                    <input
                      id="st-notes"
                      type="text"
                      className="field-input"
                      placeholder="e.g. Payout for order #123"
                      maxLength={50}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      disabled={submitting}
                    />
                  </div>
                </div>
                {msg && (
                  <div className={`alert ${msg.error ? 'alert-error' : 'alert-success'}`}>
                    {msg.text}
                  </div>
                )}
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting || !companyId}
                  style={{ gap: 7 }}
                >
                  <Icon d={IconPaths.transfer} size={13} />
                  {submitting ? 'Sending…' : 'Create transfer'}
                </button>
              </form>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.transfer} size={14} />
              <span className="card-title">Recent transfers</span>
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
                {transfers.length}
              </span>
            </div>
          </div>
          <div className="card-body">
            {loadingTransfers ? (
              <div className="empty-state">
                <p>Loading…</p>
              </div>
            ) : transfers.length === 0 ? (
              <div className="empty-state">
                <p>No transfers yet</p>
                <p>Create a transfer above to see it here.</p>
              </div>
            ) : (
              <>
                <div
                  className="account-row account-row-header"
                  style={{
                    padding: '8px 20px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    marginBottom: 0,
                  }}
                >
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Date
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Amount
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Fee
                  </div>
                  <div style={{ flex: 2, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Destination
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    ID
                  </div>
                </div>
                {transfers.map((t) => (
                  <div key={t.id} className="account-row">
                    <div style={{ flex: 1 }}>{formatDate(t.created_at)}</div>
                    <div style={{ flex: 1, fontWeight: 500 }}>{formatCurrency(t.amount, t.currency || 'usd')}</div>
                    <div style={{ flex: 1, color: 'var(--text-2)' }}>
                      {t.fee_amount != null && t.fee_amount > 0 ? formatCurrency(t.fee_amount, t.currency || 'usd') : '—'}
                    </div>
                    <div style={{ flex: 2 }} className="account-id monospace" title={t.destination_ledger_account_id}>
                      {(t.destination_ledger_account_id || '').slice(0, 24)}
                      {(t.destination_ledger_account_id?.length ?? 0) > 24 ? '…' : ''}
                    </div>
                    <div style={{ flex: 1 }} className="account-id monospace" title={t.id}>
                      {t.id.slice(0, 12)}…
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
