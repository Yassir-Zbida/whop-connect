import { useState, useEffect } from 'react';
import { Icon, IconPaths } from '../components/Icon';
import { getTransfers, type Transfer } from '../api';
import { useToast } from '../context/ToastContext';
import { logError } from '../utils/logger';

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    });
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

export default function Transactions() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const load = () => {
    setLoading(true);
    setError(null);
    getTransfers()
      .then((res) => {
        setTransfers(res.data || []);
      })
      .catch((err) => {
        setTransfers([]);
        const msg = err instanceof Error ? err.message : 'Failed to load transfers';
        setError(msg);
        logError('Load transfers', msg);
        showToast(msg, 'error');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="main">
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="topbar-title">Transactions</span>
          <span className="topbar-sub">· Whop API transfers</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading} style={{ gap: 6 }}>
          <Icon d={IconPaths.refresh} size={12} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <div className="content">
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.transfer} size={14} />
              <span className="card-title">Transfers</span>
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
            <p className="card-desc">
              Transfer history from your company (Whop API). Sent via Connected accounts → Send funds.
            </p>
            {error && (
              <div className="alert alert-error" style={{ marginBottom: 16 }}>
                {error}
              </div>
            )}
            {loading ? (
              <div className="empty-state">
                <p>Loading…</p>
              </div>
            ) : transfers.length === 0 && !error ? (
              <div className="empty-state">
                <p>No transfers yet</p>
                <p>Send funds from Connected accounts to see them here.</p>
              </div>
            ) : transfers.length === 0 ? null : (
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
