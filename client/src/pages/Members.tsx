import { useState, useEffect } from 'react';
import { Icon, IconPaths } from '../components/Icon';
import { getMembers, type Member } from '../api';
import { useToast } from '../context/ToastContext';
import { logError } from '../utils/logger';

function formatDate(iso: string | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function formatUsd(amount: number | undefined) {
  if (amount == null) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount);
}

export default function Members() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const load = () => {
    setLoading(true);
    setError(null);
    getMembers()
      .then((res) => setMembers(res.data || []))
      .catch((err) => {
        setMembers([]);
        const msg = err instanceof Error ? err.message : 'Failed to load members';
        setError(msg);
        logError('Load members', msg);
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
          <span className="topbar-title">Members</span>
          <span className="topbar-sub">· Customers (Whop API)</span>
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
              <Icon d={IconPaths.users} size={14} />
              <span className="card-title">Members & customers</span>
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
                {members.length}
              </span>
            </div>
          </div>
          <div className="card-body">
            <p className="card-desc">
              People who have joined your company or have memberships to your products (Whop API).
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
            ) : members.length === 0 && !error ? (
              <div className="empty-state">
                <p>No members yet</p>
                <p>Members and customers will appear here when they join or purchase from your company.</p>
              </div>
            ) : members.length === 0 ? null : (
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
                  <div style={{ flex: 2, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Member
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Status
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Total spent
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Joined
                  </div>
                </div>
                {members.map((m) => (
                  <div key={m.id} className="account-row">
                    <div style={{ flex: 2 }}>
                      <div className="account-name">
                        {m.user?.name || m.user?.username || '—'}
                      </div>
                      {m.user?.username && (
                        <div className="account-username">@{m.user.username}</div>
                      )}
                      {m.user?.email && (
                        <div className="account-username" style={{ fontSize: 12 }}>
                          {m.user.email}
                        </div>
                      )}
                      <div className="account-id monospace" style={{ marginTop: 2 }}>
                        {m.id}
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <span
                        className="badge badge-active"
                        style={{
                          background: m.access_level === 'customer' ? 'var(--green-dim)' : 'var(--surface-3)',
                          color: m.access_level === 'customer' ? 'var(--green)' : 'var(--text-2)',
                          borderColor: m.access_level === 'customer' ? 'rgba(34,197,94,0.2)' : 'var(--border)',
                        }}
                      >
                        {m.access_level || m.status || '—'}
                      </span>
                    </div>
                    <div style={{ flex: 1, fontWeight: 500 }}>
                      {formatUsd(m.usd_total_spent)}
                    </div>
                    <div style={{ flex: 1 }} className="account-username">
                      {formatDate(m.joined_at || m.created_at)}
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
