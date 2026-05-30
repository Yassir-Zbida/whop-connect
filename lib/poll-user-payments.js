/**
 * Poll Whop for new paid payments and enqueue background processing.
 * Mirrors Whopper do_poll: first run records timestamp only; later runs use updated_after.
 */

import * as db from '../db.js';
import { getWhop, getWhopCompanyId } from './whop-service.js';
import { mapWithConcurrency } from './concurrency.js';
import { getEffectiveProcessedIds } from './transfer-lookup.js';

const DEFAULT_PARALLEL = Number(process.env.PAYMENT_POLL_PARALLEL) || 5;

function toIsoDateTime(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function paginatedItems(page) {
  if (!page) return [];
  if (typeof page.getPaginatedItems === 'function') return page.getPaginatedItems();
  if (Array.isArray(page.data)) return page.data;
  return [];
}

async function wakeWorker() {
  const { wakePaymentWorker } = await import('./payment-worker.js');
  wakePaymentWorker();
}

/**
 * One poll cycle for a user.
 * @param {number} userId
 * @param {{ fullScan?: boolean, manual?: boolean, pollParallel?: number }} options
 */
export async function doPollUserPayments(userId, options = {}) {
  const { fullScan = false, manual = false, pollParallel: pollParallelOverride } = options;
  const whop = await getWhop(userId);
  const companyId = await getWhopCompanyId(userId);
  if (!whop || !companyId) {
    return {
      ok: false,
      reason: 'not_configured',
      queued: 0,
      skipped: 0,
      errors: [],
      firstPoll: false,
    };
  }

  const settings = await db.getUserSettings(userId);
  const lastPollAt = settings?.last_poll_at ?? null;
  const maxParallel = Math.max(
    1,
    Math.min(
      50,
      pollParallelOverride ??
        settings?.poll_parallel ??
        DEFAULT_PARALLEL
    )
  );

  if (!fullScan && !manual && settings && !settings.poll_enabled) {
    return {
      ok: true,
      reason: 'poll_disabled',
      queued: 0,
      skipped: 0,
      errors: [],
      firstPoll: false,
      message: 'Background poller is disabled in your settings.',
    };
  }

  if (!fullScan && !lastPollAt) {
    await db.recordPollCycle(userId, { firstPoll: true });
    return {
      ok: true,
      reason: 'first_poll',
      queued: 0,
      skipped: 0,
      errors: [],
      firstPoll: true,
      message: 'First poll recorded start time; no payments processed.',
    };
  }

  const processed = await getEffectiveProcessedIds(userId, whop, companyId);
  const results = { queued: 0, skipped: 0, errors: [] };
  let pollError = null;
  let newPaymentIds = [];

  try {
    const listParams = {
      company_id: companyId,
      first: 100,
      order: 'paid_at',
      direction: 'desc',
      statuses: ['paid'],
    };
    const updatedAfter = toIsoDateTime(lastPollAt);
    if (!fullScan && updatedAfter) {
      listParams.updated_after = updatedAfter;
    }

    let page;
    try {
      page = await whop.payments.list(listParams);
    } catch (listErr) {
      if (listParams.statuses) {
        delete listParams.statuses;
        page = await whop.payments.list(listParams);
      } else {
        throw listErr;
      }
    }

    const items = paginatedItems(page);

    for (const p of items) {
      if (p.status !== 'paid' || !p.id) {
        results.skipped++;
        continue;
      }
      if (processed.has(p.id)) {
        results.skipped++;
        continue;
      }
      newPaymentIds.push(p.id);
    }

    if (newPaymentIds.length > 0) {
      const enqueueResults = await mapWithConcurrency(
        newPaymentIds,
        maxParallel,
        async (paymentId) => {
          try {
            const q = await db.enqueuePaymentJob(userId, paymentId);
            return { paymentId, queued: q.queued, error: null };
          } catch (e) {
            return { paymentId, queued: false, error: e?.message || String(e) };
          }
        }
      );
      for (const r of enqueueResults) {
        if (r.error) {
          results.errors.push({ payment_id: r.paymentId, message: r.error });
        } else if (r.queued) {
          results.queued++;
        } else {
          results.skipped++;
        }
      }
      if (results.queued > 0) {
        await wakeWorker();
      }
    }
  } catch (e) {
    pollError = e?.message || String(e);
    results.errors.push({ payment_id: null, message: pollError });
  }

  await db.recordPollCycle(userId, { error: pollError, firstPoll: false });

  const updatedSettings = await db.getUserSettings(userId);
  return {
    ok: !pollError,
    reason: pollError
      ? 'poll_error'
      : newPaymentIds.length
        ? 'processed'
        : 'no_new_payments',
    queued: results.queued,
    skipped: results.skipped,
    errors: results.errors,
    firstPoll: false,
    manual,
    fullScan,
    lastPollAt: updatedSettings?.last_poll_at ?? null,
    pollsTotal: updatedSettings?.polls_total ?? 0,
    message: pollError
      ? pollError
      : results.queued > 0
        ? `Queued ${results.queued} payment(s) for processing.`
        : 'No new payments to process.',
  };
}
