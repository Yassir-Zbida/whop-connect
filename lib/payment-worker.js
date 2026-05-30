/**
 * Background worker: processes payment_jobs queue with global + per-user concurrency.
 * Per-user enable/disable is controlled in Settings (worker_enabled), not env.
 */

import * as db from '../db.js';
import { mapWithConcurrency, Semaphore } from './concurrency.js';
import { processPaymentWorkflows, evaluatePaymentJobOutcome } from './payment-workflows.js';

const POLL_MS = Number(process.env.PAYMENT_WORKER_POLL_MS) || 800;
const BATCH_SIZE = Number(process.env.PAYMENT_WORKER_BATCH_SIZE) || 25;
const GLOBAL_CONCURRENCY = Number(process.env.PAYMENT_WORKER_CONCURRENCY) || 10;
const STALE_SECONDS = Number(process.env.PAYMENT_JOB_STALE_SECONDS) || 120;

let globalSemaphore = new Semaphore(GLOBAL_CONCURRENCY);
let pollTimer = null;
let running = false;
let wakePending = false;

async function processJob(job) {
  return globalSemaphore.run(async () => {
    try {
      const result = await processPaymentWorkflows(job.user_id, job.payment_id);
      const outcome = evaluatePaymentJobOutcome(result);

      if (outcome.shouldComplete) {
        await db.completePaymentJob(job.id, result);
        return { ok: true, jobId: job.id };
      }

      const requeue = outcome.shouldRequeue && job.attempts < job.max_attempts;
      const errMsg = outcome.lastError || 'Payment workflow did not complete';
      if (requeue) {
        console.warn(
          `[payment-worker] Job ${job.id} will retry (attempt ${job.attempts}/${job.max_attempts}): ${errMsg}`
        );
      } else {
        console.error(`[payment-worker] Job ${job.id} failed permanently: ${errMsg}`);
      }
      await db.failPaymentJob(job.id, errMsg, requeue);
      return { ok: false, jobId: job.id, error: errMsg, requeue };
    } catch (e) {
      const msg = e?.message || String(e);
      console.error(`[payment-worker] Job ${job.id} failed:`, msg);
      const requeue = job.attempts < job.max_attempts;
      await db.failPaymentJob(job.id, msg, requeue);
      return { ok: false, jobId: job.id, error: msg };
    }
  });
}

async function runBatch() {
  const released = await db.releaseStalePaymentJobs(STALE_SECONDS);
  if (released > 0) {
    console.log(`[payment-worker] Released ${released} stale job(s) back to pending`);
  }

  const jobs = await db.claimPendingPaymentJobs(BATCH_SIZE);
  if (!jobs.length) return 0;

  await mapWithConcurrency(jobs, GLOBAL_CONCURRENCY, (job) => processJob(job));
  return jobs.length;
}

async function tick() {
  if (running) {
    wakePending = true;
    return;
  }
  running = true;
  try {
    do {
      wakePending = false;
      let processed = 0;
      do {
        processed = await runBatch();
      } while (processed >= BATCH_SIZE);
    } while (wakePending);
  } catch (e) {
    console.error('[payment-worker] Batch error:', e?.message || e);
  } finally {
    running = false;
    if (wakePending) {
      setImmediate(() => tick());
    }
  }
}

export function wakePaymentWorker() {
  setImmediate(() => tick());
}

export function startPaymentWorker() {
  if (pollTimer) return;
  console.log(
    `[payment-worker] Started poll=${POLL_MS}ms batch=${BATCH_SIZE} concurrency=${GLOBAL_CONCURRENCY} (per-user enable in Settings)`
  );
  pollTimer = setInterval(() => tick(), POLL_MS);
  tick();
}

export function stopPaymentWorker() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Process pending queue jobs for one user immediately (manual trigger; bypasses worker_enabled).
 */
export async function processUserPendingJobs(userId, options = {}) {
  const { manual = true } = options;
  const settings = await db.getUserSettings(userId);
  if (!manual && settings && !settings.worker_enabled) {
    return {
      ok: true,
      reason: 'worker_disabled',
      processed: 0,
      failed: 0,
      pending: 0,
      errors: [],
      message: 'Background worker is disabled in your settings.',
    };
  }

  let processed = 0;
  let failed = 0;
  const errors = [];
  let batch;

  do {
    batch = await db.claimPendingPaymentJobsForUser(userId, BATCH_SIZE);
    if (!batch.length) break;

    const results = await mapWithConcurrency(batch, GLOBAL_CONCURRENCY, (job) => processJob(job));
    for (const r of results) {
      if (r.ok) processed++;
      else {
        failed++;
        if (r.error) errors.push({ jobId: r.jobId, message: r.error });
      }
    }
  } while (batch.length >= BATCH_SIZE);

  const stats = await db.getUserPaymentJobStats(userId);
  return {
    ok: failed === 0,
    reason: processed > 0 ? 'processed' : stats.pending > 0 ? 'partial' : 'no_pending',
    processed,
    failed,
    pending: stats.pending,
    processing: stats.processing,
    errors,
    manual,
    message:
      processed > 0
        ? `Processed ${processed} queued payment(s).`
        : stats.pending > 0
          ? `${stats.pending} payment(s) still pending.`
          : 'No pending payments in queue.',
  };
}

export function getWorkerConfig() {
  return {
    enabled: true,
    perUserSettings: true,
    pollMs: POLL_MS,
    batchSize: BATCH_SIZE,
    globalConcurrency: GLOBAL_CONCURRENCY,
    staleSeconds: STALE_SECONDS,
  };
}

export function getWorkerStatus() {
  return {
    pollTimerActive: Boolean(pollTimer),
    batchRunning: running,
    wakePending,
  };
}
