import { useState, useMemo } from 'react';
import { Icon, IconPaths } from '../components/Icon';
import { useLogs, type LogEntry, type LogLevel } from '../context/LogContext';

const LEVELS: LogLevel[] = ['debug', 'info', 'success', 'error'];

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    const time = d.toLocaleTimeString(undefined, {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const ms = d.getMilliseconds().toString().padStart(3, '0');
    return `${time}.${ms}`;
  } catch {
    return iso;
  }
}

export default function Logs() {
  const { entries, clearLogs } = useLogs();
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = entries;
    if (levelFilter !== 'all') {
      list = list.filter((e) => e.level === levelFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (e) =>
          e.action.toLowerCase().includes(q) ||
          e.message.toLowerCase().includes(q) ||
          JSON.stringify(e.meta || {}).toLowerCase().includes(q)
      );
    }
    return list;
  }, [entries, levelFilter, search]);

  const handleExport = () => {
    const lines = filtered.map((e) =>
      [e.timestamp, e.level.toUpperCase().padEnd(7), e.action, e.message, e.meta ? JSON.stringify(e.meta) : ''].join('\t')
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `app-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyAll = () => {
    const text = filtered
      .map((e) => `[${e.timestamp}] ${e.level} ${e.action} ${e.message}${e.meta ? ' ' + JSON.stringify(e.meta) : ''}`)
      .join('\n');
    navigator.clipboard.writeText(text);
  };

  return (
    <main className="main">
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="topbar-title">System logs</span>
          <span className="topbar-sub">· Debug &amp; monitor</span>
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
          <button className="btn btn-ghost btn-sm" onClick={clearLogs} style={{ gap: 6, color: 'var(--red)' }}>
            <Icon d={IconPaths.trash} size={12} />
            Clear
          </button>
        </div>
      </div>

      <div className="content">
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Icon d={IconPaths.terminal} size={14} />
              <span className="card-title">Log stream</span>
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
                {filtered.length} / {entries.length}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'nowrap' }}>
              <select
                className="select-native"
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value as LogLevel | 'all')}
                style={{ minWidth: 120, flexShrink: 0 }}
              >
                <option value="all">All levels</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <input
                type="search"
                className="field-input"
                placeholder="Search action, message, meta…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ minWidth: 200, flex: 1 }}
              />
            </div>
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
              <div style={{ flex: '0 0 72px', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' }}>
                Level
              </div>
              <div style={{ flex: '0 0 100px', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' }}>
                Action
              </div>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' }}>
                Message
              </div>
              <div style={{ flex: '0 0 40px' }} />
            </div>
            {filtered.length === 0 ? (
              <div className="empty-state">
                <p>{entries.length === 0 ? 'No logs yet' : 'No logs match the filter'}</p>
                <p style={{ color: 'var(--text-2)', fontSize: 14 }}>
                  {entries.length === 0 ? 'Actions and API calls will appear here.' : 'Try changing level or search.'}
                </p>
              </div>
            ) : (
              <div style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
                {filtered.map((entry) => (
                  <LogRow
                    key={entry.id}
                    entry={entry}
                    expanded={expandedId === entry.id}
                    onToggle={() => setExpandedId((id) => (id === entry.id ? null : entry.id))}
                  />
                ))}
              </div>
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
  entry: LogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasMeta = entry.meta && Object.keys(entry.meta).length > 0;
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
          {formatTime(entry.timestamp)}
        </div>
        <div style={{ flex: '0 0 72px' }}>
          <span className={`log-badge log-badge--${entry.level}`}>{entry.level}</span>
        </div>
        <div style={{ flex: '0 0 100px', fontSize: 13, fontWeight: 500 }}>{entry.action}</div>
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, wordBreak: 'break-word' }}>{entry.message}</div>
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
