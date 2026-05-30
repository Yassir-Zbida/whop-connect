/**
 * System health checks for admin dashboard.
 */

import * as db from '../db.js';
import { getWorkerConfig, getWorkerStatus } from './payment-worker.js';
import { getPollerConfig, getPollerStatus } from './payment-poller.js';

function worstStatus(current, next) {
  const rank = { healthy: 0, degraded: 1, warning: 2, critical: 3 };
  return rank[next] > rank[current] ? next : current;
}

export async function collectSystemHealth() {
  const checks = [];
  let overall = 'healthy';

  try {
    await db.query('SELECT 1');
    checks.push({ id: 'database', name: 'Database', status: 'healthy', message: 'Connected' });
  } catch (e) {
    checks.push({
      id: 'database',
      name: 'Database',
      status: 'critical',
      message: e?.message || 'Connection failed',
    });
    overall = 'critical';
  }

  let queueStats = null;
  let queueTableOk = false;
  try {
    queueStats = await db.getPaymentJobQueueStats();
    queueTableOk = true;
    const pending = queueStats.pending || 0;
    const failed = queueStats.failed || 0;
    checks.push({
      id: 'payment_jobs',
      name: 'Payment queue',
      status: 'healthy',
      message: `${pending} pending · ${failed} failed (all time)`,
      details: queueStats,
    });
  } catch (e) {
    checks.push({
      id: 'payment_jobs',
      name: 'Payment queue',
      status: 'warning',
      message: 'payment_jobs table missing — run scripts/migrate-payment-jobs.sql',
    });
    overall = worstStatus(overall, 'degraded');
  }

  const worker = getWorkerConfig();
  const workerStatus = getWorkerStatus();
  if (!workerStatus.pollTimerActive) {
    checks.push({
      id: 'worker',
      name: 'Payment worker',
      status: 'warning',
      message: 'Poll timer not active — restart the server',
      details: { ...worker, ...workerStatus },
    });
    overall = worstStatus(overall, 'degraded');
  } else {
    checks.push({
      id: 'worker',
      name: 'Payment worker',
      status: 'healthy',
      message: workerStatus.batchRunning
        ? 'Processing batch'
        : 'Running (enable per account in Settings)',
      details: { ...worker, ...workerStatus },
    });
  }

  const poller = getPollerConfig();
  const pollerStatus = getPollerStatus();
  if (!poller.enabled) {
    checks.push({
      id: 'payment_poller',
      name: 'Payment poller',
      status: 'warning',
      message: 'Disabled (PAYMENT_POLLER_ENABLED=false)',
      details: { ...poller, ...pollerStatus },
    });
    overall = worstStatus(overall, 'degraded');
  } else if (!pollerStatus.pollTimerActive) {
    checks.push({
      id: 'payment_poller',
      name: 'Payment poller',
      status: 'warning',
      message: 'Configured but poll timer not active',
      details: { ...poller, ...pollerStatus },
    });
    overall = worstStatus(overall, 'degraded');
  } else {
    checks.push({
      id: 'payment_poller',
      name: 'Payment poller',
      status: 'healthy',
      message: pollerStatus.tickRunning
        ? `Polling ${pollerStatus.lastTickUsers} user(s)`
        : 'Idle',
      details: { ...poller, ...pollerStatus },
    });
  }

  if (queueTableOk && queueStats) {
    const pending = queueStats.pending || 0;
    if (pending > 200) {
      checks.push({
        id: 'queue_depth',
        name: 'Queue depth',
        status: 'critical',
        message: `${pending} jobs waiting — backlog is high`,
      });
      overall = worstStatus(overall, 'critical');
    } else if (pending > 50) {
      checks.push({
        id: 'queue_depth',
        name: 'Queue depth',
        status: 'warning',
        message: `${pending} jobs waiting`,
      });
      overall = worstStatus(overall, 'degraded');
    } else {
      checks.push({
        id: 'queue_depth',
        name: 'Queue depth',
        status: 'healthy',
        message: pending === 0 ? 'No backlog' : `${pending} pending`,
      });
    }

    try {
      const oldestPendingSeconds = await db.getOldestPendingJobAgeSeconds();
      if (oldestPendingSeconds != null && oldestPendingSeconds > 600) {
        checks.push({
          id: 'stale_pending',
          name: 'Oldest pending job',
          status: 'warning',
          message: `Oldest pending job is ${Math.round(oldestPendingSeconds / 60)} min old`,
          details: { seconds: oldestPendingSeconds },
        });
        overall = worstStatus(overall, 'degraded');
      }
    } catch (_) {}
  }

  let failed24h = 0;
  try {
    failed24h = await db.getPaymentJobsFailedSinceHours(24);
    if (failed24h > 20) {
      checks.push({
        id: 'failed_jobs_24h',
        name: 'Failed jobs (24h)',
        status: 'warning',
        message: `${failed24h} jobs failed in the last 24 hours`,
      });
      overall = worstStatus(overall, 'degraded');
    } else {
      checks.push({
        id: 'failed_jobs_24h',
        name: 'Failed jobs (24h)',
        status: 'healthy',
        message: failed24h === 0 ? 'No failures in 24h' : `${failed24h} failed`,
      });
    }
  } catch (_) {}

  let encryptionOk = false;
  try {
    const { ensureEncryptionKey } = await import('./crypto.js');
    ensureEncryptionKey();
    encryptionOk = true;
    checks.push({
      id: 'encryption',
      name: 'Secret encryption',
      status: 'healthy',
      message: 'ENCRYPTION_KEY configured',
    });
  } catch (e) {
    checks.push({
      id: 'encryption',
      name: 'Secret encryption',
      status: 'critical',
      message: e?.message || 'ENCRYPTION_KEY missing',
    });
    overall = worstStatus(overall, 'critical');
  }

  return {
    status: overall,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    nodeEnv: process.env.NODE_ENV || 'development',
    checks,
    queue: queueStats,
    worker: { ...worker, ...workerStatus },
    encryptionConfigured: encryptionOk,
    failedJobs24h: failed24h,
  };
}
