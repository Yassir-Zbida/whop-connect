import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { getMe, getAdminAnalytics } from '../api';
import type { AdminAnalytics } from '../api';
import {
  WorkflowKpis,
  QueuePanel,
  WorkflowsPanel,
  UsersDetailPanel,
} from '../components/admin/AnalyticsPanels';

type AnalyticsTab = 'overview' | 'queues' | 'workflows' | 'users';

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

// Colors visible on dark background; aligned with app accent/green/red
const CHART_COLORS = [
  'rgba(250, 70, 22, 0.85)',   // accent orange
  'rgba(34, 197, 94, 0.85)',  // green
  'rgba(234, 179, 8, 0.85)',  // amber
  'rgba(239, 68, 68, 0.85)',  // red
  'rgba(168, 85, 247, 0.85)', // purple
  'rgba(6, 182, 212, 0.85)',  // cyan
];

const TICK_COLOR = '#b4b4be';
const GRID_COLOR = 'rgba(255, 255, 255, 0.06)';

function formatShortDate(isoDate: string) {
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  } catch {
    return isoDate;
  }
}

export default function Analytics() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<AnalyticsTab>('overview');

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
    setLoading(true);
    getAdminAnalytics(days)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [allowed, days]);

  // Derive chart data from `data` (safe when null – empty arrays)
  const signupsLabels = data?.signupsByDay?.map((d) => d.date) || [];
  const signupsValues = data?.signupsByDay?.map((d) => d.count) || [];
  const loginsLabels = data?.loginsByDay?.map((d) => d.date) || [];
  const loginsValues = data?.loginsByDay?.map((d) => d.count) || [];
  const totalSignups = data?.signupsByDay?.reduce((s, d) => s + d.count, 0) ?? 0;
  const totalLogins = data?.loginsByDay?.reduce((s, d) => s + d.count, 0) ?? 0;
  const actionLabels = data?.activityByAction?.map((a) => a.action) || [];
  const actionValues = data?.activityByAction?.map((a) => a.count) || [];
  const appStats = data?.appStats;
  const transferCreatesByDay = data?.transferCreatesByDay || [];
  const transferByDayLabels = transferCreatesByDay.map((d) => d.date);
  const transferByDayValues = transferCreatesByDay.map((d) => d.count);

  // Key actions for "App actions" chart (friendly labels)
  const KEY_ACTIONS: Record<string, string> = {
    company_create: 'Connected account',
    transfer_create: 'Transfer',
    webhook_split: 'Auto-split run',
    webhook_auto_transfer: 'Auto-transfer run',
    split_rule_create: 'Split rule added',
    auto_transfer_rule_create: 'Auto-transfer rule added',
    split_rule_delete: 'Split rule deleted',
    auto_transfer_rule_delete: 'Auto-transfer rule deleted',
    settings_update: 'Settings update',
    login: 'Login',
    register: 'Sign up',
  };
  const keyActionData = (data?.activityByAction || [])
    .filter((a) => KEY_ACTIONS[a.action] != null)
    .map((a) => ({ label: KEY_ACTIONS[a.action] || a.action, count: a.count }));
  const keyActionLabels = keyActionData.map((a) => a.label);
  const keyActionValues = keyActionData.map((a) => a.count);

  const barOptions = useMemo(
    () => ({
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
          ticks: {
            color: TICK_COLOR,
            font: { size: 12 },
            maxRotation: 45,
            callback: (value: unknown): string | number =>
              typeof value === 'string' ? formatShortDate(value) : (value as number),
          },
        },
      },
    }),
    []
  );

  const signupsChartData = useMemo(
    () => ({
      labels: signupsLabels,
      datasets: [
        {
          label: 'Signups',
          data: signupsValues,
          backgroundColor: CHART_COLORS[0],
          borderColor: 'rgba(250, 70, 22, 1)',
          borderWidth: 1,
        },
      ],
    }),
    [signupsLabels, signupsValues]
  );

  const loginsChartData = useMemo(
    () => ({
      labels: loginsLabels,
      datasets: [
        {
          label: 'Logins',
          data: loginsValues,
          borderColor: CHART_COLORS[1],
          backgroundColor: 'rgba(34, 197, 94, 0.2)',
          fill: true,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 5,
          pointBackgroundColor: CHART_COLORS[1],
          pointBorderColor: '#fff',
          pointBorderWidth: 1,
        },
      ],
    }),
    [loginsLabels, loginsValues]
  );

  const doughnutData = useMemo(
    () => ({
      labels: actionLabels,
      datasets: [
        {
          data: actionValues,
          backgroundColor: actionLabels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
          borderWidth: 0,
        },
      ],
    }),
    [actionLabels, actionValues]
  );

  const transferByDayChartData = useMemo(
    () => ({
      labels: transferByDayLabels,
      datasets: [
        {
          label: 'Transfers',
          data: transferByDayValues,
          backgroundColor: CHART_COLORS[2],
          borderColor: 'rgba(234, 179, 8, 1)',
          borderWidth: 1,
        },
      ],
    }),
    [transferByDayLabels, transferByDayValues]
  );

  const keyActionsChartData = useMemo(
    () => ({
      labels: keyActionLabels,
      datasets: [
        {
          label: 'Count',
          data: keyActionValues,
          backgroundColor: keyActionLabels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
          borderWidth: 1,
          borderColor: keyActionLabels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length].replace('0.85', '1')),
        },
      ],
    }),
    [keyActionLabels, keyActionValues]
  );

  const doughnutOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right' as const,
          labels: {
            color: '#f0f0f0',
            font: { size: 13 },
            padding: 14,
            usePointStyle: true,
          },
        },
        tooltip: {
          titleColor: '#f0f0f0',
          bodyColor: '#e5e5e5',
          backgroundColor: 'rgba(17, 17, 17, 0.95)',
          borderColor: '#2a2a2a',
          borderWidth: 1,
        },
      },
    }),
    []
  );

  if (allowed === null) {
    return (
      <main className="main">
        <div className="topbar">
          <span className="topbar-title">Analytics</span>
        </div>
        <div style={{ padding: 24, color: 'var(--text-2)' }}>Checking access…</div>
      </main>
    );
  }

  if (!allowed) return null;

  return (
    <main className="main">
      <div className="topbar">
        <div className="topbar-heading">
          <div className="topbar-heading-row">
            <span className="topbar-title">Analytics</span>
            <span className="topbar-sub">· Metrics & queues</span>
          </div>
        </div>
        <div className="topbar-actions">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="select-native"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>


      <div className="admin-tabs" style={{ padding: '0 24px', marginTop: 8 }}>
        {(
          [
            ['overview', 'Overview'],
            ['queues', 'Payment queue'],
            ['workflows', 'Split & transfer'],
            ['users', 'User detail'],
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
        ) : tab === 'queues' ? (
          <QueuePanel data={data} />
        ) : tab === 'workflows' ? (
          <WorkflowsPanel data={data} />
        ) : tab === 'users' ? (
          <UsersDetailPanel data={data} />
        ) : (
          <>
            <WorkflowKpis data={data} />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 10,
                marginBottom: 24,
              }}
            >
              <div className="card analytics-stat-card" style={{ padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>{data.usersTotal}</div>
                <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4 }}>Total users</div>
              </div>
              <div className="card analytics-stat-card" style={{ padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--green)' }}>{totalSignups}</div>
                <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4 }}>Signups (period)</div>
              </div>
              <div className="card analytics-stat-card" style={{ padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>{totalLogins}</div>
                <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4 }}>Logins (period)</div>
              </div>
              <div className="card analytics-stat-card" style={{ padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'rgba(6, 182, 212, 0.95)' }}>{appStats?.autoSplitRulesTotal ?? 0}</div>
                <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4 }}>Auto-split rules</div>
              </div>
              <div className="card analytics-stat-card" style={{ padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'rgba(234, 179, 8, 0.95)' }}>{appStats?.autoTransferRulesTotal ?? 0}</div>
                <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4 }}>Auto-transfer rules</div>
              </div>
              <div className="card analytics-stat-card" style={{ padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--green)' }}>{appStats?.transferCreatesInPeriod ?? 0}</div>
                <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4 }}>Transfers (period)</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24 }}>
              <div className="card">
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon d={IconPaths.chart} size={14} />
                    <span className="card-title">Signups by day</span>
                  </div>
                </div>
                <div className="card-body" style={{ paddingTop: 8 }}>
                  <div style={{ height: 280 }}>
                    <Bar options={barOptions} data={signupsChartData} />
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon d={IconPaths.chart} size={14} />
                    <span className="card-title">Logins by day</span>
                  </div>
                </div>
                <div className="card-body" style={{ paddingTop: 8 }}>
                  <div style={{ height: 280 }}>
                    <Line options={barOptions} data={loginsChartData} />
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon d={IconPaths.chart} size={14} />
                    <span className="card-title">Transfers by day</span>
                  </div>
                </div>
                <div className="card-body" style={{ paddingTop: 8 }}>
                  <div style={{ height: 280 }}>
                    <Bar options={barOptions} data={transferByDayChartData} />
                  </div>
                </div>
              </div>
            </div>

            <div className="card" style={{ marginTop: 24 }}>
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon d={IconPaths.chart} size={14} />
                  <span className="card-title">Key app actions (period)</span>
                </div>
              </div>
              <div className="card-body" style={{ paddingTop: 8 }}>
                <div style={{ height: Math.max(220, keyActionLabels.length * 36) }}>
                  <Bar
                    options={{
                      ...barOptions,
                      indexAxis: 'y' as const,
                      scales: {
                        ...barOptions.scales,
                        x: { ...barOptions.scales?.x, grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: { size: 12 } } },
                        y: { ...barOptions.scales?.y, grid: { display: false }, ticks: { color: TICK_COLOR, font: { size: 12 } } },
                      },
                    }}
                    data={keyActionsChartData}
                  />
                </div>
              </div>
            </div>

            <div className="card" style={{ marginTop: 24 }}>
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon d={IconPaths.chart} size={14} />
                  <span className="card-title">Activity by action type</span>
                </div>
              </div>
              <div className="card-body" style={{ paddingTop: 8, maxWidth: 560, margin: '0 auto' }}>
                <div style={{ height: 300 }}>
                  <Doughnut data={doughnutData} options={doughnutOptions} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
