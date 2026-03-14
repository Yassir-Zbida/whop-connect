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
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="topbar-title">Analytics</span>
          <span className="topbar-sub">· Admin overview</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="select-native"
            style={{ minWidth: 140, height: 40 }}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
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
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 16,
                marginBottom: 24,
              }}
            >
              <div className="card" style={{ padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>{data.usersTotal}</div>
                <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4 }}>Total users</div>
              </div>
              <div className="card" style={{ padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--green)' }}>{totalSignups}</div>
                <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4 }}>Signups (period)</div>
              </div>
              <div className="card" style={{ padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>{totalLogins}</div>
                <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4 }}>Logins (period)</div>
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
