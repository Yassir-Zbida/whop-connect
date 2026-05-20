/**
 * In-process concurrency limits + MySQL advisory locks for per-user serialization.
 */

import * as db from '../db.js';

export class Semaphore {
  constructor(max) {
    this.max = Math.max(1, max);
    this.current = 0;
    this.queue = [];
  }

  acquire() {
    if (this.current < this.max) {
      this.current += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release() {
    this.current = Math.max(0, this.current - 1);
    const next = this.queue.shift();
    if (next) {
      this.current += 1;
      next();
    }
  }

  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/** Run tasks with a max number in flight. */
export async function mapWithConcurrency(items, limit, fn) {
  const sem = new Semaphore(limit);
  return Promise.all(
    items.map((item, index) =>
      sem.run(() => fn(item, index))
    )
  );
}

const MYSQL_LOCK_TIMEOUT_SEC = 30;

/** Serialize payment processing per user (safe across multiple server instances). */
export async function withUserLock(userId, fn) {
  const lockName = `whop_pay_user_${userId}`;
  const rows = await db.query('SELECT GET_LOCK(?, ?) AS got', [lockName, MYSQL_LOCK_TIMEOUT_SEC]);
  const got = rows[0]?.got === 1 || rows[0]?.got === '1';
  if (!got) {
    throw new Error(`Could not acquire processing lock for user ${userId}`);
  }
  try {
    return await fn();
  } finally {
    try {
      await db.query('SELECT RELEASE_LOCK(?)', [lockName]);
    } catch (_) {
      /* ignore */
    }
  }
}
