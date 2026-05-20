import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, IconPaths } from '../components/Icon';
import { getMe, getAdminHealth } from '../api';
import type { HealthCheck, SystemHealth } from '../api';

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function statusColor(status: string) {
  if (status === 'healthy') return 'var(--green)';
  if (status === 'critical') return 'var(--red)';
  if (status === 'warning' || status === 'degraded') return 'rgba(234, 179, 8, 0.95)';
  return 'var(--text-2)';
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      style={{
        color: statusColor(status),
        background:
          status === 'healthy'
            ? 'var(--green-dim)'
            : status === 'critical'
              ? 'var(--red-dim)'
              : 'rgba(234, 179, 8, 0.12)',
        border: `1px solid ${statusColor(status)}33`,
        padding: '2px 8px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase',
      }}
    >
      {status}
    </span>
  );
}

function StatMini({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{label}</div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: highlight ? 'rgba(234, 179, 8, 0.95)' : 'var(--text)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ChecksList({ checks }: { checks: HealthCheck[] }) {
  return (
    <table className="metrics-table" style={{ width: '100%' }}>
      <thead>
        <tr>
          <th>Check</th>
          <th>Status</th>
          <th>Message</th>
        </tr>
      </thead>
      <tbody>
        {checks.map((c) => (
          <tr key={c.id}>
            <td style={{ fontWeight: 500 }}>{c.name}</td>
            <td>
              <StatusBadge status={c.status} />
            </td>
            <td style={{ color: 'var(--text-2)', fontSize: 14 }}>{c.message}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function SystemHealthPage() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getAdminHealth()
      .then((h) => {
        setHealth(h);
        setLastRefresh(new Date());
      })
      .catch(() => setHealth(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    getMe()
      .then((d) => {
        if (d?.user?.role !== 'admin') {
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
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [allowed, load]);

  if (allowed === null) {
    return (
      <main className="main">
        <div className="topbar">
          <span className="topbar-title">System health</span>
        </div>
        <div style={{ padding: 24, color: 'var(--text-2)' }}>Checking access…</div>
      </main>
    );
  }

  if (!allowed) return null;

  const q = health?.queue;

  return (
    <main className="main">
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="topbar-title">System health</span>
          <span className="topbar-sub">· Live status</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastRefresh && (
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            <Icon d={IconPaths.refresh} size={13} />
            Refresh
          </button>
        </div>
      </div>

      <div className="content" style={{ padding: 24 }}>
        {loading && !health ? (
          <div className="card">
            <div className="card-body">
              <p style={{ color: 'var(--text-2)' }}>Loading health status…</p>
            </div>
          </div>
        ) : !health ? (
          <div className="card">
            <div className="card-body">
              <p style={{ color: 'var(--red)' }}>Failed to load system health.</p>
            </div>
          </div>
        ) : (
          <>
            <div
              className="card"
              style={{
                marginBottom: 24,
                padding: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: `${statusColor(health.status)}22`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon d={IconPaths.shield} size={24} style={{ color: statusColor(health.status) }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 4 }}>Overall status</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 26, fontWeight: 700, textTransform: 'capitalize' }}>
                      {health.status}
                    </span>
                    <StatusBadge status={health.status} />
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <StatMini label="Uptime" value={formatUptime(health.uptimeSeconds)} />
                <StatMini label="Environment" value={health.nodeEnv} />
                <StatMini
                  label="Queue pending"
                  value={String(q?.pending ?? '—')}
                  highlight={q != null && q.pending > 50}
                />
                <StatMini label="Failed (24h)" value={String(health.failedJobs24h)} />
              </div>
            </div>

            <div className="card" style={{ marginBottom: 24 }}>
              <div className="card-header">
                <span className="card-title">Health checks</span>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <ChecksList checks={health.checks} />
              </div>
            </div>

            {health.worker && (
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Payment worker</span>
                </div>
                <div className="card-body">
                  <pre
                    style={{
                      margin: 0,
                      fontSize: 13,
                      color: 'var(--text-2)',
                      fontFamily: 'var(--mono)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {JSON.stringify(health.worker, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
