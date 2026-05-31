import { useMemo } from 'react';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import type { AdminAnalytics, QueueUserStats, WorkflowUserMetrics } from '../../api';
import { formatChartDateLabel } from '../../lib/analyticsPeriod';

const CHART_COLORS = [
  'rgba(250, 70, 22, 0.85)',
  'rgba(34, 197, 94, 0.85)',
  'rgba(234, 179, 8, 0.85)',
  'rgba(239, 68, 68, 0.85)',
  'rgba(168, 85, 247, 0.85)',
  'rgba(6, 182, 212, 0.85)',
];

const TICK_COLOR = '#b4b4be';
const GRID_COLOR = 'rgba(255, 255, 255, 0.06)';

const barOptionsBase = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      titleColor: '#f0f0f0',
      bodyColor: '#e5e5e5',
      backgroundColor: 'rgba(17, 17, 17, 0.95)',
      borderColor: '#2a2a2a',
      borderWidth: 1,
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      grid: { color: GRID_COLOR },
      ticks: { color: TICK_COLOR, font: { size: 12 } },
    },
    x: {
      grid: { display: false },
      ticks: { color: TICK_COLOR, font: { size: 11 }, maxRotation: 45 },
    },
  },
};

function pct(v: number | null | undefined) {
  if (v == null) return '—';
  return `${v}%`;
}

function RateCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="card analytics-stat-card" style={{ padding: 20, textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

export function WorkflowKpis({ data }: { data: AdminAnalytics }) {
  const wf = data.workflows?.global;
  const q = data.queue;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 10,
        marginBottom: 24,
      }}
    >
      <RateCard label="Job completion rate" value={pct(q?.jobCompletionRate)} color="var(--green)" />
      <RateCard label="Split run rate" value={pct(wf?.splitRunRate)} sub={`${wf?.splitRan ?? 0} ran / ${wf?.splitEvents ?? 0}`} color="rgba(6, 182, 212, 0.95)" />
      <RateCard label="Transfer success rate" value={pct(wf?.transferSuccessRate)} sub={`${wf?.transferSuccess ?? 0} ok / ${wf?.transferEvents ?? 0}`} color="rgba(234, 179, 8, 0.95)" />
      <RateCard label="Queue pending" value={String(q?.global?.pending ?? 0)} color="var(--accent)" />
      <RateCard label="Queue failed (24h)" value={String(q?.failedLast24h ?? 0)} color="var(--red)" />
      <RateCard label="Worker" value={data.worker?.enabled ? 'On' : 'Off'} sub={data.workerStatus?.batchRunning ? 'Processing' : 'Idle'} color="var(--text)" />
    </div>
  );
}

export function QueuePanel({ data }: { data: AdminAnalytics }) {
  const q = data.queue;
  const useHourly = data.useHourly ?? false;
  const byDay = q?.byDay || [];
  const labels = byDay.map((d) => d.date);

  const stackedData = useMemo(
    () => ({
      labels,
      datasets: [
        { label: 'Completed', data: byDay.map((d) => d.completed), backgroundColor: CHART_COLORS[1] },
        { label: 'Failed', data: byDay.map((d) => d.failed), backgroundColor: CHART_COLORS[3] },
        { label: 'Pending', data: byDay.map((d) => d.pending), backgroundColor: CHART_COLORS[2] },
      ],
    }),
    [byDay, labels]
  );

  const statusDoughnut = useMemo(() => {
    const g = q?.global || { pending: 0, processing: 0, completed: 0, failed: 0 };
    return {
      labels: ['Pending', 'Processing', 'Completed', 'Failed'],
      datasets: [
        {
          data: [g.pending, g.processing, g.completed, g.failed],
          backgroundColor: CHART_COLORS,
          borderWidth: 0,
        },
      ],
    };
  }, [q?.global]);

  if (q?.tableAvailable === false) {
    return (
      <div className="card">
        <div className="card-body">
          <p style={{ color: 'var(--text-2)' }}>
            Payment queue not available. Run <code>scripts/migrate-payment-jobs.sql</code> on your database.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Jobs by status (all time)</span>
          </div>
          <div className="card-body" style={{ height: 280 }}>
            <Doughnut
              data={statusDoughnut}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { position: 'right', labels: { color: '#f0f0f0', usePointStyle: true } },
                },
              }}
            />
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Jobs created per day</span>
          </div>
          <div className="card-body" style={{ height: 280 }}>
            <Bar
              data={stackedData}
              options={{
                ...barOptionsBase,
                plugins: { ...barOptionsBase.plugins, legend: { display: true, labels: { color: '#f0f0f0' } } },
                scales: {
                  ...barOptionsBase.scales,
                  x: {
                    ...barOptionsBase.scales.x,
                    stacked: true,
                    ticks: {
                      ...barOptionsBase.scales.x.ticks,
                      callback: (v) =>
                        typeof v === 'string' ? formatChartDateLabel(v, useHourly) : v,
                    },
                  },
                  y: { ...barOptionsBase.scales.y, stacked: true },
                },
              }}
            />
          </div>
        </div>
      </div>

      <QueueUserTable users={q?.byUser || []} />
    </>
  );
}

export function QueueUserTable({ users }: { users: QueueUserStats[] }) {
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-header">
        <span className="card-title">Payment queue per user</span>
      </div>
      <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="metrics-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Split</th>
              <th>Transfer</th>
              <th>Pending</th>
              <th>Processing</th>
              <th>Completed</th>
              <th>Failed</th>
              <th>Completion %</th>
              <th>Last job</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ color: 'var(--text-2)', padding: 16 }}>
                  No queue activity yet.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.userId}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{u.email}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>#{u.userId}</div>
                  </td>
                  <td>{u.autoSplitEnabled ? `On (${u.splitRules})` : 'Off'}</td>
                  <td>{u.autoTransferEnabled ? `On (${u.transferRules})` : 'Off'}</td>
                  <td style={{ color: u.pending > 0 ? 'rgba(234, 179, 8, 0.95)' : undefined }}>{u.pending}</td>
                  <td>{u.processing}</td>
                  <td style={{ color: 'var(--green)' }}>{u.completed}</td>
                  <td style={{ color: u.failed > 0 ? 'var(--red)' : undefined }}>{u.failed}</td>
                  <td>{pct(u.completionRate)}</td>
                  <td style={{ fontSize: 13, color: 'var(--text-2)' }}>
                    {u.lastJobAt ? new Date(u.lastJobAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function WorkflowsPanel({ data }: { data: AdminAnalytics }) {
  const wf = data.workflows;
  const byDay = wf?.byDay || [];
  const labels = byDay.map((d) => d.date);

  const lineData = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: 'Auto-split events',
          data: byDay.map((d) => d.split),
          borderColor: CHART_COLORS[4],
          backgroundColor: 'rgba(168, 85, 247, 0.15)',
          fill: true,
          tension: 0.3,
        },
        {
          label: 'Auto-transfer events',
          data: byDay.map((d) => d.transfer),
          borderColor: CHART_COLORS[0],
          backgroundColor: 'rgba(250, 70, 22, 0.12)',
          fill: true,
          tension: 0.3,
        },
      ],
    }),
    [byDay, labels]
  );

  const successDoughnut = useMemo(() => {
    const g = wf?.global;
    if (!g) return null;
    return {
      labels: ['Transfer OK', 'Transfer errors', 'Split ran', 'Split skipped'],
      datasets: [
        {
          data: [
            g.transferSuccess,
            Math.max(0, g.transferEvents - g.transferSuccess),
            g.splitRan,
            g.splitSkipped,
          ],
          backgroundColor: [CHART_COLORS[1], CHART_COLORS[3], CHART_COLORS[4], CHART_COLORS[2]],
          borderWidth: 0,
        },
      ],
    };
  }, [wf?.global]);

  return (
    <>
      <WorkflowKpis data={data} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Workflow events per day</span>
          </div>
          <div className="card-body" style={{ height: 280 }}>
            <Line
              data={lineData}
              options={{
                ...barOptionsBase,
                plugins: { ...barOptionsBase.plugins, legend: { display: true, labels: { color: '#f0f0f0' } } },
              }}
            />
          </div>
        </div>
        {successDoughnut && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">Split & transfer outcomes (period)</span>
            </div>
            <div className="card-body" style={{ height: 280 }}>
              <Doughnut
                data={successDoughnut}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { position: 'right', labels: { color: '#f0f0f0', usePointStyle: true } } },
                }}
              />
            </div>
          </div>
        )}
      </div>
      <WorkflowUserTable users={wf?.byUser || []} />
    </>
  );
}

function WorkflowUserTable({ users }: { users: WorkflowUserMetrics[] }) {
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-header">
        <span className="card-title">Workflow metrics per user</span>
      </div>
      <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="metrics-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Split events</th>
              <th>Split ran</th>
              <th>Run rate</th>
              <th>Transfer events</th>
              <th>Transfers OK</th>
              <th>With errors</th>
              <th>Success rate</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ color: 'var(--text-2)', padding: 16 }}>
                  No webhook workflow activity in this period.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.userId}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{u.email || `User #${u.userId}`}</div>
                  </td>
                  <td>{u.splitEvents}</td>
                  <td>{u.splitRan}</td>
                  <td>{pct(u.splitRunRate)}</td>
                  <td>{u.transferEvents}</td>
                  <td style={{ color: 'var(--green)' }}>{u.transferSuccess}</td>
                  <td style={{ color: u.transferWithErrors > 0 ? 'var(--red)' : undefined }}>
                    {u.transferWithErrors}
                  </td>
                  <td>{pct(u.transferSuccessRate)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function UsersDetailPanel({ data }: { data: AdminAnalytics }) {
  const queueMap = new Map((data.queue?.byUser || []).map((u) => [u.userId, u]));
  const wfMap = new Map((data.workflows?.byUser || []).map((u) => [u.userId, u]));
  const ids = new Set([...queueMap.keys(), ...wfMap.keys()]);

  const rows = Array.from(ids).map((id) => ({
    userId: id,
    email: queueMap.get(id)?.email || wfMap.get(id)?.email || `User #${id}`,
    queue: queueMap.get(id),
    workflow: wfMap.get(id),
  }));

  rows.sort((a, b) => {
    const ap = (a.queue?.pending || 0) + (a.queue?.processing || 0);
    const bp = (b.queue?.pending || 0) + (b.queue?.processing || 0);
    if (bp !== ap) return bp - ap;
    return a.email.localeCompare(b.email);
  });

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Combined user metrics</span>
      </div>
      <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="metrics-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Queue pending</th>
              <th>Job completion</th>
              <th>Split run rate</th>
              <th>Transfer success</th>
              <th>Split on</th>
              <th>Transfer on</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: 'var(--text-2)', padding: 16 }}>
                  No users with automation or queue data.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.userId}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{r.email}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>#{r.userId}</div>
                  </td>
                  <td>{(r.queue?.pending || 0) + (r.queue?.processing || 0)}</td>
                  <td>{pct(r.queue?.completionRate ?? null)}</td>
                  <td>{pct(r.workflow?.splitRunRate ?? null)}</td>
                  <td>{pct(r.workflow?.transferSuccessRate ?? null)}</td>
                  <td>{r.queue?.autoSplitEnabled ? 'Yes' : 'No'}</td>
                  <td>{r.queue?.autoTransferEnabled ? 'Yes' : 'No'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
