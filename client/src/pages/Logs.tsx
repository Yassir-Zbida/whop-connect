import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, IconPaths } from '../components/Icon';
import { getMe, getAdminLogs } from '../api';
import type { ActivityLogEntry } from '../api';
import { useToast } from '../context/ToastContext';

const PAGE_SIZE = 100;

function formatDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  } catch {
    return iso;
  }
}

export default function Logs() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Filters
  const [filterUser, setFilterUser] = useState('');
  const [filterEmail, setFilterEmail] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterAction, setFilterAction] = useState('');

  const load = useCallback(
    (resetOffset = true) => {
      const off = resetOffset ? 0 : offset;
      setLoading(true);
      getAdminLogs(PAGE_SIZE, off, {
        user_id: filterUser ? Number(filterUser) : undefined,
        email: filterEmail.trim() || undefined,
        from: filterFrom.trim() ? `${filterFrom.trim()}T00:00:00.000Z` : undefined,
        to: filterTo.trim() ? `${filterTo.trim()}T23:59:59.999Z` : undefined,
        action: filterAction.trim() || undefined,
      })
        .then((res) => {
          const data = res.data || [];
          if (resetOffset) {
            setEntries(data);
            setOffset(data.length);
          } else {
            setEntries((prev) => [...prev, ...data]);
            setOffset((o) => o + data.length);
          }
          setHasMore(data.length === PAGE_SIZE);
        })
        .catch(() => showToast('Failed to load logs', 'error'))
        .finally(() => setLoading(false));
    },
    [filterUser, filterEmail, filterFrom, filterTo, filterAction, offset, showToast]
  );

  useEffect(() => {
    getMe()
      .then((data) => {
        if (data?.user?.role !== 'admin') {
          setAllowed(false);
          navigate('/', { replace: true });
        } else {
          setAllowed(true);
        }
      })
      .catch(() => {
        setAllowed(false);
        navigate('/login', { replace: true });
      });
  }, [navigate]);

  useEffect(() => {
    if (!allowed) return;
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, filterUser, filterEmail, filterFrom, filterTo, filterAction]);

  const applyFilters = () => load(true);

  const loadMore = () => {
    if (loading || !hasMore) return;
    load(false);
  };

  const handleExport = () => {
    const lines = entries.map((e) =>
      [
        e.created_at,
        e.email ?? '',
        e.user_id ?? '',
        e.action,
        e.message,
        e.meta ? JSON.stringify(e.meta) : '',
      ].join('\t')
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `app-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported');
  };

  const copyAll = () => {
    const text = entries
      .map((e) => `[${e.created_at}] ${e.email ?? ''} ${e.action} ${e.message}${e.meta ? ' ' + JSON.stringify(e.meta) : ''}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard');
  };

  if (allowed === null) {
    return (
      <main className="main">
        <div className="topbar">
          <span className="topbar-title">App logs</span>
        </div>
        <div style={{ padding: 24, color: 'var(--text-2)' }}>Checking access…</div>
      </main>
    );
  }

  if (!allowed) return null;

  return (
    <main className="main">
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="topbar-title">App logs</span>
          <span className="topbar-sub">· Monitor whole app (admin only)</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={copyAll} style={{ gap: 6 }}>
            <Icon d={IconPaths.edit} size={12} />
            Copy
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleExport} style={{ gap: 6 }}>
            <Icon d={IconPaths.receipt} size={12} />
            Export
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => load(true)} style={{ gap: 6 }} disabled={loading}>
            <Icon d={IconPaths.refresh} size={12} />
            Refresh
          </button>
        </div>
      </div>

      <div className="content">
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <span className="card-title">Filter logs</span>
          </div>
          <div className="card-body">
            <div className="logs-filter-row">
              <label className="logs-filter-label">
                <span className="logs-filter-label-text">User ID</span>
                <input
                  type="text"
                  className="field-input logs-filter-input"
                  placeholder="e.g. 1"
                  value={filterUser}
                  onChange={(e) => setFilterUser(e.target.value)}
                />
              </label>
              <label className="logs-filter-label">
                <span className="logs-filter-label-text">Email</span>
                <input
                  type="text"
                  className="field-input logs-filter-input"
                  placeholder="user@example.com"
                  value={filterEmail}
                  onChange={(e) => setFilterEmail(e.target.value)}
                />
              </label>
              <label className="logs-filter-label">
                <span className="logs-filter-label-text">From date</span>
                <input
                  type="date"
                  className="field-input logs-filter-input"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                />
              </label>
              <label className="logs-filter-label">
                <span className="logs-filter-label-text">To date</span>
                <input
                  type="date"
                  className="field-input logs-filter-input"
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                />
              </label>
              <label className="logs-filter-label">
                <span className="logs-filter-label-text">Action</span>
                <input
                  type="text"
                  className="field-input logs-filter-input"
                  placeholder="e.g. login, webhook_received"
                  value={filterAction}
                  onChange={(e) => setFilterAction(e.target.value)}
                />
              </label>
              <div className="logs-filter-actions">
                <button type="button" className="btn btn-primary logs-filter-btn" onClick={applyFilters} disabled={loading}>
                  Apply filters
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Activity log</span>
            <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{entries.length} rows</span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div
              className="account-row account-row-header"
              style={{
                padding: '10px 20px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--surface-2)',
                marginBottom: 0,
              }}
            >
              <div style={{ flex: '0 0 140px', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' }}>
                Time
              </div>
              <div style={{ flex: '0 0 120px', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' }}>
                User
              </div>
              <div style={{ flex: '0 0 140px', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' }}>
                Action
              </div>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' }}>
                Message
              </div>
              <div style={{ flex: '0 0 40px' }} />
            </div>
            {loading && entries.length === 0 ? (
              <div className="empty-state">
                <p>Loading logs…</p>
              </div>
            ) : entries.length === 0 ? (
              <div className="empty-state">
                <p>No logs match the filters</p>
                <p style={{ color: 'var(--text-2)', fontSize: 14 }}>Try changing filters or date range.</p>
              </div>
            ) : (
              <>
                <div style={{ maxHeight: 'calc(100vh - 420px)', overflowY: 'auto' }}>
                  {entries.map((entry) => (
                    <LogRow
                      key={entry.id}
                      entry={entry}
                      expanded={expandedId === entry.id}
                      onToggle={() => setExpandedId((id) => (id === entry.id ? null : entry.id))}
                    />
                  ))}
                </div>
                {hasMore && (
                  <div style={{ padding: 16, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={loadMore}
                      disabled={loading}
                    >
                      {loading ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function LogRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: ActivityLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasMeta = entry.meta && Object.keys(entry.meta).length > 0;
  const userLabel = entry.email ?? (entry.user_id != null ? `#${entry.user_id}` : '—');
  return (
    <div
      className="log-row"
      style={{
        borderBottom: '1px solid var(--border)',
        padding: '10px 20px',
        background: expanded ? 'var(--surface-2)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 140px', fontSize: 13, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
          {formatDateTime(entry.created_at)}
        </div>
        <div style={{ flex: '0 0 120px', fontSize: 13, wordBreak: 'break-all' }}>{userLabel}</div>
        <div style={{ flex: '0 0 140px' }}>
          <code style={{ fontSize: 12, background: 'var(--surface-3)', padding: '2px 6px', borderRadius: 4 }}>
            {entry.action}
          </code>
        </div>
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, wordBreak: 'break-word' }}>{entry.message || '—'}</div>
        <div style={{ flex: '0 0 40px' }}>
          {hasMeta && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onToggle}
              style={{ padding: 4 }}
              title={expanded ? 'Collapse meta' : 'Expand meta'}
            >
              {expanded ? '−' : '+'}
            </button>
          )}
        </div>
      </div>
      {expanded && hasMeta && (
        <pre
          className="log-meta"
          style={{
            marginTop: 10,
            marginLeft: 0,
            padding: 12,
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
            overflow: 'auto',
            color: 'var(--text-2)',
          }}
        >
          {JSON.stringify(entry.meta, null, 2)}
        </pre>
      )}
    </div>
  );
}
