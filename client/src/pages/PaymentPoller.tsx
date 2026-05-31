import { useState, useEffect } from 'react';
import { Icon, IconPaths } from '../components/Icon';
import { getSettings, updateSettings, pollPaymentsNow, processPaymentQueueNow } from '../api';
import { useToast } from '../context/ToastContext';
import { logSuccess, logError } from '../utils/logger';

export default function PaymentPoller() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pollEnabled, setPollEnabled] = useState(true);
  const [pollTickMs, setPollTickMs] = useState('60000');
  const [pollParallel, setPollParallel] = useState('5');
  const [workerEnabled, setWorkerEnabled] = useState(true);
  const [workerConcurrency, setWorkerConcurrency] = useState('5');
  const [workerPending, setWorkerPending] = useState(0);
  const [workerProcessing, setWorkerProcessing] = useState(0);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [pollsTotal, setPollsTotal] = useState(0);
  const [lastPollAt, setLastPollAt] = useState<string | null>(null);
  const [lastPollError, setLastPollError] = useState<string | null>(null);
  const [pollingNow, setPollingNow] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const { showToast } = useToast();

  const loadSettings = () => {
    getSettings()
      .then((s) => {
        setPollEnabled(s.pollEnabled !== false);
        setPollTickMs(String(s.pollTickMs ?? (s.pollIntervalSeconds ?? 60) * 1000));
        setPollParallel(String(s.pollParallel ?? 5));
        setWorkerEnabled(s.workerEnabled !== false);
        setWorkerConcurrency(String(s.workerConcurrency ?? 5));
        setWorkerPending(s.workerQueue?.pending ?? 0);
        setWorkerProcessing(s.workerQueue?.processing ?? 0);
        setPollsTotal(s.pollsTotal ?? 0);
        setLastPollAt(s.lastPollAt ?? null);
        setLastPollError(s.lastPollError ?? null);
      })
      .catch(() => setMsg({ text: 'Failed to load poller settings', error: true }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const tickNum = parseInt(pollTickMs, 10);
    const parallelNum = parseInt(pollParallel, 10);
    const workerConcurrencyNum = parseInt(workerConcurrency, 10);
    if (
      pollTickMs.trim() !== '' &&
      (!Number.isFinite(tickNum) || tickNum < 1000 || tickNum > 86400000)
    ) {
      setMsg({ text: 'Poll interval must be between 1000 and 86400000 milliseconds.', error: true });
      return;
    }
    if (
      pollParallel.trim() !== '' &&
      (!Number.isFinite(parallelNum) || parallelNum < 1 || parallelNum > 50)
    ) {
      setMsg({ text: 'Max parallel enqueues must be between 1 and 50.', error: true });
      return;
    }
    if (
      workerConcurrency.trim() !== '' &&
      (!Number.isFinite(workerConcurrencyNum) || workerConcurrencyNum < 1 || workerConcurrencyNum > 50)
    ) {
      setMsg({ text: 'Max parallel worker jobs must be between 1 and 50.', error: true });
      return;
    }
    setSaving(true);
    try {
      await updateSettings({
        pollEnabled,
        pollTickMs: tickNum,
        pollParallel: parallelNum,
        workerEnabled,
        workerConcurrency: workerConcurrencyNum,
      });
      logSuccess('Payment poller', 'Poller settings saved');
      showToast('Poller settings saved');
      setMsg({ text: 'Saved.', error: false });
      loadSettings();
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Failed to save';
      setMsg({ text, error: true });
      logError('Payment poller', text);
      showToast(text, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePollNow = async () => {
    setPollingNow(true);
    setMsg(null);
    try {
      const res = await pollPaymentsNow();
      const text =
        res.message ||
        (res.firstPoll
          ? 'First poll recorded. Future polls will process new payments.'
          : `Queued ${res.queued}, skipped ${res.skipped}.`);
      setMsg({ text, error: !res.ok && (res.errors?.length ?? 0) > 0 });
      showToast(text, !res.ok && (res.errors?.length ?? 0) > 0 ? 'error' : 'success');
      if (res.ok) logSuccess('Payment poll', text, res);
      else logError('Payment poll', text, res);
      const s = await getSettings();
      setPollsTotal(s.pollsTotal ?? 0);
      setLastPollAt(s.lastPollAt ?? null);
      setLastPollError(s.lastPollError ?? null);
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Poll failed';
      setMsg({ text, error: true });
      showToast(text, 'error');
      logError('Payment poll', text);
    } finally {
      setPollingNow(false);
    }
  };

  const handleProcessQueue = async () => {
    setProcessingQueue(true);
    setMsg(null);
    try {
      const res = await processPaymentQueueNow();
      const text = res.message || `Processed ${res.processed} payment(s).`;
      setMsg({ text, error: !res.ok && (res.failed ?? 0) > 0 });
      showToast(text, !res.ok && (res.failed ?? 0) > 0 ? 'error' : 'success');
      if (res.ok) logSuccess('Payment worker', text, res);
      else logError('Payment worker', text, res);
      const s = await getSettings();
      setWorkerPending(s.workerQueue?.pending ?? 0);
      setWorkerProcessing(s.workerQueue?.processing ?? 0);
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Process queue failed';
      setMsg({ text, error: true });
      showToast(text, 'error');
      logError('Payment worker', text);
    } finally {
      setProcessingQueue(false);
    }
  };

  if (loading) {
    return (
      <main className="main">
        <div className="topbar">
          <span className="topbar-title">Payment poller</span>
        </div>
        <div className="content">
          <div className="card">
            <div className="card-body">
              <p style={{ color: 'var(--text-2)' }}>Loading…</p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="main">
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="topbar-title">Payment poller</span>
          <span className="topbar-sub">· Poll Whop for payments & process your queue</span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setLoading(true);
            loadSettings();
          }}
          disabled={saving || pollingNow || processingQueue}
          style={{ gap: 6 }}
        >
          <Icon d={IconPaths.refresh} size={12} />
          Refresh
        </button>
      </div>

      <div className="content">
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.refresh} size={14} />
              <span className="card-title">Background poller</span>
            </div>
          </div>
          <div className="card-body">
            <p className="card-desc">
              Polls Whop for new paid payments when auto-split or auto-transfer is enabled. Manual &quot;Poll now&quot;
              works even when the background poller is off.
            </p>
            {msg && (
              <div
                className={msg.error ? 'alert alert-error' : 'alert'}
                style={msg.error ? undefined : { background: 'var(--success-bg)', color: 'var(--success)', marginBottom: 14 }}
              >
                {msg.text}
              </div>
            )}
            <form onSubmit={handleSave}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 14,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                <input
                  type="checkbox"
                  checked={pollEnabled}
                  onChange={(e) => setPollEnabled(e.target.checked)}
                  disabled={saving}
                />
                <span>
                  <strong>Enable background poller</strong>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', fontWeight: 400 }}>
                    Automatically check Whop for new payments on a schedule.
                  </span>
                </span>
              </label>
              <div className="form-grid-3">
                <div className="field">
                  <label className="field-label">Poll interval (milliseconds)</label>
                  <input
                    className="field-input"
                    type="number"
                    min="1000"
                    max="86400000"
                    step="1000"
                    placeholder="60000"
                    value={pollTickMs}
                    onChange={(e) => setPollTickMs(e.target.value)}
                    disabled={saving}
                  />
                  <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
                    Default 60000 = 60 seconds.
                  </p>
                </div>
                <div className="field">
                  <label className="field-label">Max parallel enqueues per poll</label>
                  <input
                    className="field-input"
                    type="number"
                    min="1"
                    max="50"
                    step="1"
                    placeholder="5"
                    value={pollParallel}
                    onChange={(e) => setPollParallel(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div className="field">
                  <label className="field-label">Max parallel worker jobs</label>
                  <input
                    className="field-input"
                    type="number"
                    min="1"
                    max="50"
                    step="1"
                    placeholder="5"
                    value={workerConcurrency}
                    onChange={(e) => setWorkerConcurrency(e.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>

              <div
                style={{
                  marginTop: 8,
                  paddingTop: 16,
                  borderTop: '1px solid var(--border)',
                }}
              >
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>
                  Payment worker
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>
                  Processes webhooks and polled payments in the background (auto-split / auto-transfer). When
                  disabled, payments stay queued until you click Process queue.
                </p>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    marginBottom: 14,
                    cursor: 'pointer',
                    fontSize: 14,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={workerEnabled}
                    onChange={(e) => setWorkerEnabled(e.target.checked)}
                    disabled={saving}
                  />
                  <span>
                    <strong>Enable background worker</strong>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', fontWeight: 400 }}>
                      Automatically process queued payments for your account.
                    </span>
                  </span>
                </label>
              </div>

              <div
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handlePollNow}
                  disabled={pollingNow || saving}
                  style={{ gap: 6 }}
                >
                  <Icon d={IconPaths.refresh} size={12} />
                  {pollingNow ? 'Polling…' : 'Poll now'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleProcessQueue}
                  disabled={processingQueue || saving}
                  style={{ gap: 6 }}
                >
                  <Icon d={IconPaths.refresh} size={12} />
                  {processingQueue ? 'Processing…' : 'Process queue'}
                </button>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  {lastPollAt ? (
                    <>
                      Last poll: {new Date(lastPollAt).toLocaleString()} · {pollsTotal} total
                      {pollEnabled ? '' : ' · background poller off'}
                    </>
                  ) : (
                    <>No poll yet — first poll records start time only</>
                  )}
                  {(workerPending > 0 || workerProcessing > 0) && (
                    <span style={{ display: 'block', marginTop: 4 }}>
                      Queue: {workerPending} pending
                      {workerProcessing > 0 ? ` · ${workerProcessing} processing` : ''}
                      {workerEnabled ? '' : ' · background worker off'}
                    </span>
                  )}
                  {!workerPending && !workerProcessing && !workerEnabled && (
                    <span style={{ display: 'block', marginTop: 4 }}>Background worker off</span>
                  )}
                  {lastPollError && (
                    <span style={{ color: 'var(--danger)', display: 'block', marginTop: 4 }}>
                      Last error: {lastPollError}
                    </span>
                  )}
                </div>
              </div>

              <button className="btn btn-primary" type="submit" disabled={saving} style={{ marginTop: 16, gap: 7 }}>
                <Icon d={IconPaths.settings} size={13} />
                {saving ? 'Saving…' : 'Save poller settings'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
