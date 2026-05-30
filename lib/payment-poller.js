/**
 * Background poller: checks each user on their poll_interval_seconds schedule.
 */

import * as db from '../db.js';
import { doPollUserPayments } from './poll-user-payments.js';
import { mapWithConcurrency } from './concurrency.js';

const TICK_MS = Number(process.env.PAYMENT_POLLER_TICK_MS) || 10000;
const USER_CONCURRENCY = Number(process.env.PAYMENT_POLLER_USER_CONCURRENCY) || 3;
const ENABLED = process.env.PAYMENT_POLLER_ENABLED !== 'false';
const STARTUP_DELAY_MS = Number(process.env.PAYMENT_POLLER_STARTUP_DELAY_MS) || 3000;

let pollTimer = null;
let running = false;
let lastTickAt = null;
let lastTickUsers = 0;
let lastTickErrors = 0;

function userIsDue(user) {
  if (!user.lastPollAt) return true;
  const last = new Date(user.lastPollAt).getTime();
  if (Number.isNaN(last)) return true;
  const intervalMs = user.pollTickMs ?? user.pollIntervalSeconds * 1000;
  return Date.now() >= last + intervalMs;
}

async function pollDueUsers() {
  const users = await db.listUsersForPaymentPoll();
  const due = users.filter(userIsDue);
  lastTickUsers = due.length;
  lastTickErrors = 0;

  if (!due.length) return;

  await mapWithConcurrency(due, USER_CONCURRENCY, async (user) => {
    try {
      await doPollUserPayments(user.id, { pollParallel: user.pollParallel });
    } catch (e) {
      lastTickErrors += 1;
      console.error(`[payment-poller] User ${user.id} poll failed:`, e?.message || e);
    }
  });
}

async function tick() {
  if (running) return;
  running = true;
  lastTickAt = new Date().toISOString();
  try {
    await pollDueUsers();
  } catch (e) {
    console.error('[payment-poller] Tick error:', e?.message || e);
  } finally {
    running = false;
  }
}

export function startPaymentPoller() {
  if (!ENABLED) {
    console.log('[payment-poller] Disabled (PAYMENT_POLLER_ENABLED=false)');
    return;
  }
  if (pollTimer) return;
  console.log(
    `[payment-poller] Starting tick=${TICK_MS}ms userConcurrency=${USER_CONCURRENCY} startupDelay=${STARTUP_DELAY_MS}ms`
  );
  setTimeout(() => {
    tick();
    pollTimer = setInterval(() => tick(), TICK_MS);
  }, STARTUP_DELAY_MS);
}

export function stopPaymentPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function wakePaymentPoller() {
  if (!ENABLED) return;
  setImmediate(() => tick());
}

export function getPollerConfig() {
  return {
    enabled: ENABLED,
    tickMs: TICK_MS,
    userConcurrency: USER_CONCURRENCY,
    startupDelayMs: STARTUP_DELAY_MS,
  };
}

export function getPollerStatus() {
  return {
    pollTimerActive: Boolean(pollTimer),
    tickRunning: running,
    lastTickAt,
    lastTickUsers,
    lastTickErrors,
  };
}
