import { useState, useEffect, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import { Icon, IconPaths } from '../components/Icon';
import { getUserAnalytics } from '../api';
import type { UserAnalytics } from '../api';
import {
  ANALYTICS_PERIOD_OPTIONS,
  DEFAULT_ANALYTICS_PERIOD,
  formatChartDateLabel,
  type AnalyticsPeriod,
} from '../lib/analyticsPeriod';

type Tab = 'overview' | 'workflows';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

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

const ACTION_LABELS: Record<string, string> = {
  transfer_create: 'Manual transfer',
  webhook_split: 'Auto-split run',
  webhook_auto_transfer: 'Auto-transfer run',
  webhook_enqueue: 'Payment queued',
  payment_poll: 'Payment poll',
  company_create: 'Connected account',
  split_rule_create: 'Split rule added',
  auto_transfer_rule_create: 'Auto-transfer rule added',
  split_rule_delete: 'Split rule deleted',
  auto_transfer_rule_delete: 'Auto-transfer rule deleted',
  settings_update: 'Settings saved',
  login: 'Login',
};

function pct(v: number | null | undefined) {
  if (v == null) return '—';
  return `${v}%`;
}

const barOptions = {
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

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
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

export default function UserAnalytics() {
  const [data, setData] = useState<UserAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<AnalyticsPeriod>(DEFAULT_ANALYTICS_PERIOD);
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    setLoading(true);
    getUserAnalytics(period)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [period]);

  const useHourly = data?.useHourly ?? false;
  const formatShortDate = (isoDate: string) => formatChartDateLabel(isoDate, useHourly);

  const wf = data?.workflows?.global;
  const app = data?.appStats;
  const queue = data?.queue;

  const transferChart = useMemo(() => {
    const rows = data?.transferCreatesByDay || [];
    return {
      labels: rows.map((r) => formatShortDate(r.date)),
      datasets: [
        {
          label: 'Transfers',
          data: rows.map((r) => r.count),
          backgroundColor: CHART_COLORS[1],
        },
      ],
    };
  }, [data?.transferCreatesByDay]);

  const workflowLine = useMemo(() => {
    const rows = data?.workflows?.byDay || [];
    return {
      labels: rows.map((r) => formatShortDate(r.date)),
      datasets: [
        {
          label: 'Auto-split',
          data: rows.map((r) => r.split),
          borderColor: CHART_COLORS[4],
          backgroundColor: 'rgba(168, 85, 247, 0.15)',
          fill: true,
          tension: 0.3,
        },
        {
          label: 'Auto-transfer',
          data: rows.map((r) => r.transfer),
          borderColor: CHART_COLORS[0],
          backgroundColor: 'rgba(250, 70, 22, 0.12)',
          fill: true,
          tension: 0.3,
        },
      ],
    };
  }, [data?.workflows?.byDay]);

  const keyActions = useMemo(() => {
    const keys = [
      'transfer_create',
      'webhook_split',
      'webhook_auto_transfer',
      'webhook_enqueue',
      'payment_poll',
      'company_create',
      'split_rule_create',
      'auto_transfer_rule_create',
    ];
    const map = new Map((data?.activityByAction || []).map((a) => [a.action, a.count]));
    return keys
      .map((k) => ({ action: k, count: map.get(k) || 0, label: ACTION_LABELS[k] || k }))
      .filter((a) => a.count > 0);
  }, [data?.activityByAction]);

  const keyActionsChart = useMemo(
    () => ({
      labels: keyActions.map((a) => a.label),
      datasets: [{ data: keyActions.map((a) => a.count), backgroundColor: CHART_COLORS }],
    }),
    [keyActions]
  );

  const workflowDoughnut = useMemo(() => {
    if (!wf) return null;
    return {
      labels: ['Transfer OK', 'Transfer errors', 'Split ran', 'Split skipped'],
      datasets: [
        {
          data: [
            wf.transferSuccess ?? 0,
            Math.max(0, (wf.transferEvents ?? 0) - (wf.transferSuccess ?? 0)),
            wf.splitRan ?? 0,
            wf.splitSkipped ?? 0,
          ],
          backgroundColor: [CHART_COLORS[1], CHART_COLORS[3], CHART_COLORS[4], CHART_COLORS[2]],
          borderWidth: 0,
        },
      ],
    };
  }, [wf]);

  const queueByDay = data?.queue?.byDay || [];
  const hasWorkflows = queue?.hasWorkflows ?? false;
  const periodCompleted = queue?.periodCompleted ?? 0;
  const periodFailed = queue?.periodFailed ?? 0;
  const periodFinished = periodCompleted + periodFailed;
  const jobCompletionSub = !hasWorkflows
    ? 'Enable auto-split or auto-transfer'
    : periodFinished > 0
      ? `${periodCompleted} ok · ${periodFailed} failed`
      : 'No finished jobs in period';

  const queueStacked = useMemo(
    () => ({
      labels: queueByDay.map((d) => formatShortDate(d.date)),
      datasets: [
        { label: 'Completed', data: queueByDay.map((d) => d.completed), backgroundColor: CHART_COLORS[1] },
        { label: 'Failed', data: queueByDay.map((d) => d.failed), backgroundColor: CHART_COLORS[3] },
        { label: 'Pending', data: queueByDay.map((d) => d.pending), backgroundColor: CHART_COLORS[2] },
      ],
    }),
    [queueByDay]
  );

  return (
    <main className="main">
      <div className="topbar">
        <div className="topbar-heading">
          <div className="topbar-heading-row">
            <span className="topbar-title">Analytics</span>
            <span className="topbar-sub">· Your activity, transfers & workflows</span>
          </div>
        </div>
        <div className="topbar-actions">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as AnalyticsPeriod)}
            className="select-native"
          >
            {ANALYTICS_PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="admin-tabs" style={{ padding: '0 24px', marginTop: 8 }}>
        {(
          [
            ['overview', 'Overview'],
            ['workflows', 'Split & transfer'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`admin-tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="content" style={{ padding: 24 }}>
        {loading ? (
          <div className="card">
            <div className="card-body">
              <p style={{ color: 'var(--text-2)' }}>Loading analytics…</p>
            </div>
          </div>
        ) : !data ? (
          <div className="card">
            <div className="card-body">
              <p style={{ color: 'var(--red)' }}>Failed to load analytics.</p>
            </div>
          </div>
        ) : tab === 'workflows' ? (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 10,
                marginBottom: 24,
              }}
            >
              <StatCard label="Split run rate" value={pct(wf?.splitRunRate)} sub={`${wf?.splitRan ?? 0} ran / ${wf?.splitEvents ?? 0}`} color="rgba(168, 85, 247, 0.95)" />
              <StatCard label="Transfer success rate" value={pct(wf?.transferSuccessRate)} sub={`${wf?.transferSuccess ?? 0} ok / ${wf?.transferEvents ?? 0}`} color="rgba(234, 179, 8, 0.95)" />
              <StatCard label="Payments processed (split)" value={app?.processedSplitPayments ?? 0} color="var(--accent)" />
              <StatCard label="Payments processed (transfer)" value={app?.processedTransferPayments ?? 0} color="var(--green)" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24 }}>
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Workflow events per day</span>
                </div>
                <div className="card-body" style={{ height: 280 }}>
                  <Line
                    data={workflowLine}
                    options={{
                      ...barOptions,
                      plugins: { ...barOptions.plugins, legend: { display: true, labels: { color: '#f0f0f0' } } },
                    }}
                  />
                </div>
              </div>
              {workflowDoughnut && (
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Success vs skipped (period)</span>
                  </div>
                  <div className="card-body" style={{ height: 280 }}>
                    <Doughnut
                      data={workflowDoughnut}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: { position: 'bottom', labels: { color: '#f0f0f0', padding: 12 } },
                        },
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 10,
                marginBottom: 24,
              }}
            >
              <StatCard
                label="Job completion rate"
                value={pct(queue?.jobCompletionRate)}
                sub={jobCompletionSub}
                color="var(--green)"
              />
              <StatCard label="Manual transfers" value={app?.transferCreatesInPeriod ?? 0} color="var(--green)" />
              <StatCard label="Connected accounts" value={app?.connectedAccountsTotal ?? 0} color="rgba(6, 182, 212, 0.95)" />
              <StatCard label="Auto-split rules" value={app?.autoSplitRulesTotal ?? 0} sub={app?.autoSplitEnabled ? 'Enabled' : 'Off'} color="rgba(168, 85, 247, 0.95)" />
              <StatCard label="Auto-transfer rules" value={app?.autoTransferRulesTotal ?? 0} sub={app?.autoTransferEnabled ? 'Enabled' : 'Off'} color="rgba(234, 179, 8, 0.95)" />
              <StatCard label="Queue pending" value={queue?.global?.pending ?? 0} color="var(--accent)" />
              <StatCard label="Queue failed (24h)" value={queue?.failedLast24h ?? 0} color="var(--red)" />
              <StatCard label="Polls run" value={data.pollsTotal ?? 0} sub={data.pollEnabled ? 'Poller on' : 'Poller off'} color="var(--text)" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24 }}>
              <div className="card">
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon d={IconPaths.chart} size={14} />
                    <span className="card-title">Transfers by day</span>
                  </div>
                </div>
                <div className="card-body" style={{ height: 280 }}>
                  <Bar options={barOptions} data={transferChart} />
                </div>
              </div>
              {hasWorkflows && queueByDay.length > 0 && (
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Payment jobs by day</span>
                  </div>
                  <div className="card-body" style={{ height: 280 }}>
                    <Bar
                      data={queueStacked}
                      options={{
                        ...barOptions,
                        plugins: { ...barOptions.plugins, legend: { display: true, labels: { color: '#f0f0f0' } } },
                        scales: { ...barOptions.scales, x: { ...barOptions.scales.x, stacked: true }, y: { ...barOptions.scales.y, stacked: true } },
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {keyActions.length > 0 && (
              <div className="card" style={{ marginTop: 24 }}>
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon d={IconPaths.chart} size={14} />
                    <span className="card-title">Background activity (period)</span>
                  </div>
                </div>
                <div className="card-body" style={{ paddingTop: 8 }}>
                  <div style={{ height: Math.max(220, keyActions.length * 36) }}>
                    <Bar
                      options={{
                        ...barOptions,
                        indexAxis: 'y' as const,
                        scales: {
                          x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR } },
                          y: { grid: { display: false }, ticks: { color: TICK_COLOR } },
                        },
                      }}
                      data={keyActionsChart}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
