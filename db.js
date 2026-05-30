/**
 * MySQL data access for multi-user Whop Admin.
 * Requires: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (default whop_admin)
 */

import mysql from 'mysql2/promise';
import crypto from 'crypto';
import { decrypt, encrypt } from './lib/crypto.js';

const DB_NAME = process.env.DB_NAME || 'whop_admin';
let pool = null;

export function getPool() {
  if (!pool) {
    const host = process.env.DB_HOST || 'localhost';
    const user = process.env.DB_USER || 'root';
    const password = process.env.DB_PASSWORD || '';
    const database = process.env.DB_NAME || 'whop_admin';
    pool = mysql.createPool({
      host,
      user,
      password,
      database,
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return pool;
}

export async function query(sql, params = []) {
  const p = getPool();
  const [rows] = await p.execute(sql, params);
  return rows;
}

// ——— Users ———
export async function findUserByEmail(email) {
  const rows = await query(
    'SELECT id, email, password_hash, role, active, created_at FROM users WHERE email = ? LIMIT 1',
    [String(email).trim().toLowerCase()]
  );
  return rows[0] || null;
}

export async function createUser(email, passwordHash, role = 'user') {
  const normalized = String(email).trim().toLowerCase();
  const [result] = await getPool().execute(
    'INSERT INTO users (email, password_hash, role, active) VALUES (?, ?, ?, 1)',
    [normalized, passwordHash, role === 'admin' ? 'admin' : 'user']
  );
  return result.insertId;
}

export async function getUserById(id) {
  const rows = await query('SELECT id, email, role, active, created_at FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

export async function listUsers() {
  return query(
    'SELECT id, email, role, active, created_at FROM users ORDER BY created_at DESC'
  );
}

export async function updateUserRole(userId, role) {
  if (role !== 'admin' && role !== 'user') return false;
  const [result] = await getPool().execute('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
  return result.affectedRows > 0;
}

export async function updateUserActive(userId, active) {
  const val = active ? 1 : 0;
  const [result] = await getPool().execute('UPDATE users SET active = ? WHERE id = ?', [val, userId]);
  return result.affectedRows > 0;
}

// ——— Activity log (for admin dashboard) ———
function toJsonParam(value) {
  if (value == null) return null;
  return JSON.stringify(value);
}

export async function insertActivityLog({ userId = null, email = null, action, message = '', meta = null }) {
  const metaJson = toJsonParam(meta);
  if (metaJson == null) {
    await getPool().execute(
      'INSERT INTO activity_log (user_id, email, action, message, meta) VALUES (?, ?, ?, ?, NULL)',
      [userId, email || null, String(action).slice(0, 128), String(message).slice(0, 512)]
    );
    return;
  }
  await getPool().execute(
    'INSERT INTO activity_log (user_id, email, action, message, meta) VALUES (?, ?, ?, ?, CAST(? AS JSON))',
    [userId, email || null, String(action).slice(0, 128), String(message).slice(0, 512), metaJson]
  );
}

/** Delete activity log rows older than N days (default from ACTIVITY_LOG_RETENTION_DAYS env). */
export async function purgeActivityLogsOlderThan(days) {
  const retention =
    days != null ? Number(days) : Number(process.env.ACTIVITY_LOG_RETENTION_DAYS) || 90;
  const d = Math.max(1, Math.min(retention, 3650));
  const [result] = await getPool().execute(
    'DELETE FROM activity_log WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
    [d]
  );
  return result.affectedRows || 0;
}

/**
 * Get activity logs with optional filters. No time limit – full history.
 * @param {number} limit
 * @param {number} offset
 * @param {{ userId?: number, email?: string, from?: string, to?: string, action?: string }} filters
 */
export async function getActivityLogs(limit = 200, offset = 0, filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.userId != null && filters.userId !== '') {
    conditions.push('user_id = ?');
    params.push(Number(filters.userId));
  }
  if (filters.email != null && String(filters.email).trim() !== '') {
    conditions.push('(email = ? OR email LIKE ?)');
    const e = String(filters.email).trim();
    params.push(e, `%${e}%`);
  }
  if (filters.from != null && String(filters.from).trim() !== '') {
    conditions.push('created_at >= ?');
    params.push(String(filters.from).trim());
  }
  if (filters.to != null && String(filters.to).trim() !== '') {
    conditions.push('created_at <= ?');
    params.push(String(filters.to).trim());
  }
  if (filters.action != null && String(filters.action).trim() !== '') {
    conditions.push('action = ?');
    params.push(String(filters.action).trim().slice(0, 128));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitNum = Math.max(0, parseInt(Number(limit), 10) || 200);
  const offsetNum = Math.max(0, parseInt(Number(offset), 10) || 0);
  const rows = await query(
    `SELECT id, user_id, email, action, message, meta, created_at FROM activity_log ${where} ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offsetNum}`,
    params
  );
  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    email: r.email,
    action: r.action,
    message: r.message,
    meta: typeof r.meta === 'string' ? (r.meta ? JSON.parse(r.meta) : null) : r.meta,
    created_at: r.created_at,
  }));
}

/** Analytics: users count, signups by day, activity by action, app-wide stats (last N days). */
export async function getAnalyticsStats(days = 30) {
  const [usersCount] = await query('SELECT COUNT(*) AS total FROM users');
  const signupsByDay = await query(
    `SELECT DATE(created_at) AS date, COUNT(*) AS count FROM users WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY DATE(created_at) ORDER BY date ASC`,
    [days]
  );
  const activityByAction = await query(
    `SELECT action, COUNT(*) AS count FROM activity_log WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY action ORDER BY count DESC`,
    [days]
  );
  const loginsByDay = await query(
    `SELECT DATE(created_at) AS date, COUNT(*) AS count FROM activity_log WHERE action = 'login' AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY DATE(created_at) ORDER BY date ASC`,
    [days]
  );
  let connectedAccountsTotal = 0;
  let autoSplitRulesTotal = 0;
  let autoTransferRulesTotal = 0;
  let transferCreatesInPeriod = 0;
  let transferCreatesByDay = [];
  try {
    const [ca] = await query('SELECT COUNT(*) AS total FROM connected_accounts');
    connectedAccountsTotal = ca?.total ?? 0;
  } catch (_) {}
  try {
    const [asr] = await query('SELECT COUNT(*) AS total FROM auto_split_rules');
    autoSplitRulesTotal = asr?.total ?? 0;
  } catch (_) {}
  try {
    const [atr] = await query('SELECT COUNT(*) AS total FROM auto_transfer_rules');
    autoTransferRulesTotal = atr?.total ?? 0;
  } catch (_) {}
  try {
    const [tc] = await query(
      `SELECT COUNT(*) AS total FROM activity_log WHERE action = 'transfer_create' AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
      [days]
    );
    transferCreatesInPeriod = tc?.total ?? 0;
    transferCreatesByDay = await query(
      `SELECT DATE(created_at) AS date, COUNT(*) AS count FROM activity_log WHERE action = 'transfer_create' AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY DATE(created_at) ORDER BY date ASC`,
      [days]
    );
  } catch (_) {}
  return {
    usersTotal: usersCount?.total ?? 0,
    signupsByDay: signupsByDay || [],
    activityByAction: activityByAction || [],
    loginsByDay: loginsByDay || [],
    appStats: {
      connectedAccountsTotal,
      autoSplitRulesTotal,
      autoTransferRulesTotal,
      transferCreatesInPeriod,
    },
    transferCreatesByDay: transferCreatesByDay || [],
  };
}

export async function updateUserPassword(userId, passwordHash) {
  await query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
}

function decryptSetting(stored) {
  if (!stored) return '';
  try {
    return decrypt(stored);
  } catch (e) {
    console.error('Failed to decrypt user setting:', e?.message);
    return '';
  }
}

function encryptSetting(value) {
  if (!value) return '';
  return encrypt(String(value));
}

function normalizeSettingsRow(row) {
  if (!row) return null;
  const commissionRaw = row.platform_commission_pct;
  const commission =
    commissionRaw != null && Number.isFinite(Number(commissionRaw)) ? Number(commissionRaw) : 1;
  const cachedFeeRaw = row.cached_fee_pct;
  const cachedFeePct =
    cachedFeeRaw != null && Number.isFinite(Number(cachedFeeRaw)) ? Number(cachedFeeRaw) : null;
  const pollIntervalRaw = row.poll_interval_seconds;
  const pollIntervalSeconds =
    pollIntervalRaw != null && Number.isFinite(Number(pollIntervalRaw)) ? Number(pollIntervalRaw) : 60;
  const pollTickRaw = row.poll_tick_ms;
  const pollTickMs =
    pollTickRaw != null && Number.isFinite(Number(pollTickRaw))
      ? Number(pollTickRaw)
      : pollIntervalSeconds * 1000;
  const pollParallelRaw = row.poll_parallel;
  const pollParallel =
    pollParallelRaw != null && Number.isFinite(Number(pollParallelRaw)) ? Number(pollParallelRaw) : 5;
  const pollEnabled = row.poll_enabled == null ? true : Boolean(Number(row.poll_enabled));
  const workerConcurrencyRaw = row.worker_concurrency;
  const workerConcurrency =
    workerConcurrencyRaw != null && Number.isFinite(Number(workerConcurrencyRaw))
      ? Number(workerConcurrencyRaw)
      : 5;
  const workerEnabled = row.worker_enabled == null ? true : Boolean(Number(row.worker_enabled));
  const pollsTotal =
    row.polls_total != null && Number.isFinite(Number(row.polls_total)) ? Number(row.polls_total) : 0;
  return {
    whop_api_key: decryptSetting(row.whop_api_key),
    whop_company_id: row.whop_company_id || '',
    whop_webhook_secret: decryptSetting(row.whop_webhook_secret),
    webhook_token: row.webhook_token || '',
    platform_commission_pct: commission,
    cached_fee_pct: cachedFeePct,
    last_poll_at: row.last_poll_at ?? null,
    poll_interval_seconds: pollIntervalSeconds,
    poll_enabled: pollEnabled,
    poll_tick_ms: pollTickMs,
    poll_parallel: pollParallel,
    polls_total: pollsTotal,
    last_poll_error: row.last_poll_error || null,
    worker_enabled: workerEnabled,
    worker_concurrency: workerConcurrency,
  };
}

// ——— User settings (Whop API key, company ID, webhook token, webhook secret) ———

/** Create default settings row if missing (worker + poller on by default). */
export async function ensureUserSettings(userId) {
  const uid = Number(userId);
  if (!uid) return;
  const webhookToken = crypto.randomBytes(24).toString('hex');
  await getPool().execute(
    `INSERT INTO user_settings (user_id, webhook_token, poll_enabled, worker_enabled)
     VALUES (?, ?, 1, 1)
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [uid, webhookToken]
  );
}

export async function getUserSettings(userId) {
  await ensureUserSettings(userId);
  const rows = await query(
    `SELECT whop_api_key, whop_company_id, whop_webhook_secret, webhook_token,
            platform_commission_pct, cached_fee_pct,
            last_poll_at, poll_interval_seconds, poll_enabled, poll_tick_ms, poll_parallel,
            polls_total, last_poll_error, worker_enabled, worker_concurrency
     FROM user_settings WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  return normalizeSettingsRow(rows[0]) || null;
}

export async function updateCachedFeePct(userId, feePct) {
  const pct = Number(feePct);
  if (!Number.isFinite(pct) || pct < 0 || pct >= 1) return false;
  const [result] = await getPool().execute(
    'UPDATE user_settings SET cached_fee_pct = ? WHERE user_id = ?',
    [pct, userId]
  );
  return result.affectedRows > 0;
}

export async function setUserSettings(userId, {
  whopApiKey,
  whopCompanyId,
  whopWebhookSecret,
  platformCommissionPct,
  pollIntervalSeconds,
  pollEnabled,
  pollTickMs,
  pollParallel,
  workerEnabled,
  workerConcurrency,
}) {
  const p = getPool();
  const row = await getUserSettings(userId);
  const rawRows = await query(
    'SELECT whop_api_key, whop_webhook_secret FROM user_settings WHERE user_id = ? LIMIT 1',
    [userId]
  );
  const raw = rawRows[0] || null;

  let webhookToken = row?.webhook_token || '';
  if (!webhookToken) {
    webhookToken = crypto.randomBytes(24).toString('hex');
  }
  const apiKeyPlain =
    whopApiKey !== undefined ? String(whopApiKey).trim() : (row?.whop_api_key ?? '');
  const companyId =
    whopCompanyId !== undefined ? String(whopCompanyId).trim() : (row?.whop_company_id ?? '');
  const webhookSecretPlain =
    whopWebhookSecret !== undefined
      ? String(whopWebhookSecret).trim()
      : (row?.whop_webhook_secret ?? '');

  let commissionPct =
    row?.platform_commission_pct != null ? Number(row.platform_commission_pct) : 1;
  if (platformCommissionPct !== undefined) {
    const next = Number(platformCommissionPct);
    if (!Number.isFinite(next) || next < 0 || next > 100) {
      throw new Error('platform_commission_pct must be between 0 and 100');
    }
    commissionPct = next;
  }

  let pollInterval =
    row?.poll_interval_seconds != null ? Number(row.poll_interval_seconds) : 60;
  if (pollIntervalSeconds !== undefined) {
    const next = Math.floor(Number(pollIntervalSeconds));
    if (!Number.isFinite(next) || next < 10 || next > 86400) {
      throw new Error('poll_interval_seconds must be between 10 and 86400');
    }
    pollInterval = next;
  }

  let pollTick =
    row?.poll_tick_ms != null ? Number(row.poll_tick_ms) : pollInterval * 1000;
  if (pollTickMs !== undefined) {
    const next = Math.floor(Number(pollTickMs));
    if (!Number.isFinite(next) || next < 1000 || next > 86400000) {
      throw new Error('poll_tick_ms must be between 1000 and 86400000');
    }
    pollTick = next;
    pollInterval = Math.max(10, Math.ceil(next / 1000));
  } else if (pollIntervalSeconds !== undefined) {
    pollTick = pollInterval * 1000;
  }

  let pollEnabledVal = row?.poll_enabled == null ? true : Boolean(Number(row.poll_enabled));
  if (pollEnabled !== undefined) {
    pollEnabledVal = Boolean(pollEnabled);
  }

  let pollParallelVal = row?.poll_parallel != null ? Number(row.poll_parallel) : 5;
  if (pollParallel !== undefined) {
    const next = Math.floor(Number(pollParallel));
    if (!Number.isFinite(next) || next < 1 || next > 50) {
      throw new Error('poll_parallel must be between 1 and 50');
    }
    pollParallelVal = next;
  }

  let workerEnabledVal = row?.worker_enabled == null ? true : Boolean(Number(row.worker_enabled));
  if (workerEnabled !== undefined) {
    workerEnabledVal = Boolean(workerEnabled);
  }

  let workerConcurrencyVal = row?.worker_concurrency != null ? Number(row.worker_concurrency) : 5;
  if (workerConcurrency !== undefined) {
    const next = Math.floor(Number(workerConcurrency));
    if (!Number.isFinite(next) || next < 1 || next > 50) {
      throw new Error('worker_concurrency must be between 1 and 50');
    }
    workerConcurrencyVal = next;
  }

  let apiKeyStored = raw?.whop_api_key ?? '';
  if (whopApiKey !== undefined) {
    apiKeyStored = apiKeyPlain ? encryptSetting(apiKeyPlain) : '';
  }
  let webhookSecretStored = raw?.whop_webhook_secret ?? '';
  if (whopWebhookSecret !== undefined) {
    webhookSecretStored = webhookSecretPlain ? encryptSetting(webhookSecretPlain) : '';
  }

  await p.execute(
    `INSERT INTO user_settings (
       user_id, whop_api_key, whop_company_id, whop_webhook_secret, webhook_token,
       platform_commission_pct, poll_interval_seconds, poll_enabled, poll_tick_ms, poll_parallel,
       worker_enabled, worker_concurrency
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       whop_api_key = VALUES(whop_api_key),
       whop_company_id = VALUES(whop_company_id),
       whop_webhook_secret = IF(VALUES(whop_webhook_secret) != '', VALUES(whop_webhook_secret), whop_webhook_secret),
       webhook_token = IF(COALESCE(webhook_token, '') = '', VALUES(webhook_token), webhook_token),
       platform_commission_pct = VALUES(platform_commission_pct),
       poll_interval_seconds = VALUES(poll_interval_seconds),
       poll_enabled = VALUES(poll_enabled),
       poll_tick_ms = VALUES(poll_tick_ms),
       poll_parallel = VALUES(poll_parallel),
       worker_enabled = VALUES(worker_enabled),
       worker_concurrency = VALUES(worker_concurrency)`,
    [
      userId,
      apiKeyStored,
      companyId,
      webhookSecretStored,
      webhookToken,
      commissionPct,
      pollInterval,
      pollEnabledVal ? 1 : 0,
      pollTick,
      pollParallelVal,
      workerEnabledVal ? 1 : 0,
      workerConcurrencyVal,
    ]
  );
  return {
    whopApiKey: apiKeyPlain,
    whopCompanyId: companyId,
    whopWebhookSecret: webhookSecretPlain,
    webhookToken,
    platformCommissionPct: commissionPct,
    pollIntervalSeconds: pollInterval,
    pollEnabled: pollEnabledVal,
    pollTickMs: pollTick,
    pollParallel: pollParallelVal,
    workerEnabled: workerEnabledVal,
    workerConcurrency: workerConcurrencyVal,
  };
}

/** Users with Whop configured and auto-split or auto-transfer enabled. */
export async function listUsersForPaymentPoll() {
  const rows = await query(
    `SELECT us.user_id AS id, us.last_poll_at, us.poll_interval_seconds,
            us.poll_tick_ms, us.poll_parallel
     FROM user_settings us
     INNER JOIN users u ON u.id = us.user_id AND u.active = 1
     LEFT JOIN auto_split_config ascfg ON ascfg.user_id = us.user_id
     LEFT JOIN auto_transfer_config atc ON atc.user_id = us.user_id
     WHERE us.whop_api_key != '' AND us.whop_company_id != ''
       AND us.poll_enabled = 1
       AND (COALESCE(ascfg.enabled, 0) = 1 OR COALESCE(atc.enabled, 0) = 1)`
  );
  return rows.map((r) => {
    const tickMs =
      r.poll_tick_ms != null && Number(r.poll_tick_ms) > 0
        ? Number(r.poll_tick_ms)
        : Math.max(10000, (Number(r.poll_interval_seconds) || 60) * 1000);
    return {
      id: r.id,
      lastPollAt: r.last_poll_at,
      pollIntervalSeconds: Math.max(10, Number(r.poll_interval_seconds) || 60),
      pollTickMs: tickMs,
      pollParallel: Math.max(1, Math.min(50, Number(r.poll_parallel) || 5)),
    };
  });
}

/** Record poll cycle completion (or first-poll timestamp only). */
export async function recordPollCycle(userId, { error = null, firstPoll = false } = {}) {
  const errorStr = error ? String(error).slice(0, 512) : null;
  if (firstPoll) {
    await getPool().execute(
      'UPDATE user_settings SET last_poll_at = NOW(), last_poll_error = NULL WHERE user_id = ?',
      [userId]
    );
    return;
  }
  await getPool().execute(
    `UPDATE user_settings SET
       last_poll_at = NOW(),
       polls_total = polls_total + 1,
       last_poll_error = ?
     WHERE user_id = ?`,
    [errorStr, userId]
  );
}

export async function getUserByWebhookToken(token) {
  if (!token || typeof token !== 'string') return null;
  const rows = await query(
    'SELECT user_id AS id FROM user_settings WHERE webhook_token = ? LIMIT 1',
    [token.trim()]
  );
  return rows[0] ? { id: rows[0].id } : null;
}

// ——— Connected accounts (Whop companies linked to user) ———
export async function insertConnectedAccount(userId, { companyId, email = '', title = '' }) {
  await getPool().execute(
    'INSERT INTO connected_accounts (user_id, company_id, email, title) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email), title = VALUES(title)',
    [userId, String(companyId).trim(), String(email).slice(0, 255), String(title).slice(0, 255)]
  );
}

export async function getConnectedAccountsByUser(userId) {
  return query(
    'SELECT id, user_id, company_id, email, title, created_at FROM connected_accounts WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );
}

// ——— Auto-split config ———
const MAX_PROCESSED_IDS = 50000;

export async function getAutoSplitConfig(userId) {
  const rows = await query(
    'SELECT enabled, processed_payment_ids FROM auto_split_config WHERE user_id = ? LIMIT 1',
    [userId]
  );
  if (!rows[0]) return { enabled: false, processedPaymentIds: [] };
  let ids = rows[0].processed_payment_ids;
  if (typeof ids === 'string') {
    try {
      ids = JSON.parse(ids);
    } catch {
      ids = [];
    }
  }
  return {
    enabled: Boolean(rows[0].enabled),
    processedPaymentIds: Array.isArray(ids) ? ids : [],
  };
}

export async function setAutoSplitEnabled(userId, enabled) {
  const p = getPool();
  await p.execute(
    `INSERT INTO auto_split_config (user_id, enabled, processed_payment_ids)
     VALUES (?, ?, '[]')
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
    [userId, enabled ? 1 : 0]
  );
}

export async function getAutoSplitRules(userId) {
  const rules = await query(
    `SELECT r.id, r.product_id AS productId, r.plan_id AS planId, r.created_at AS createdAt
     FROM auto_split_rules r
     WHERE r.user_id = ?
     ORDER BY r.created_at ASC`,
    [userId]
  );
  const splits = await query(
    `SELECT s.rule_id, s.destination_id, s.percentage
     FROM auto_split_rule_splits s
     INNER JOIN auto_split_rules r ON r.id = s.rule_id AND r.user_id = ?`,
    [userId]
  );
  const byRule = {};
  for (const s of splits) {
    if (!byRule[s.rule_id]) byRule[s.rule_id] = [];
    byRule[s.rule_id].push({
      destination_id: s.destination_id,
      percentage: Number(s.percentage),
    });
  }
  return rules.map((r) => ({
    id: r.id,
    productId: r.productId || null,
    planId: r.planId || null,
    createdAt: r.createdAt,
    splits: byRule[r.id] || [],
  }));
}

export async function getFullAutoSplit(userId) {
  const config = await getAutoSplitConfig(userId);
  const rules = await getAutoSplitRules(userId);
  return {
    enabled: config.enabled,
    rules,
    processedPaymentIds: config.processedPaymentIds,
  };
}

export function validateSplitPercentages(splits) {
  const total = (splits || []).reduce((sum, s) => sum + (Number(s.percentage) || 0), 0);
  if (total > 100) {
    const err = new Error('Split percentages cannot exceed 100% combined.');
    err.code = 'SPLIT_PERCENTAGE_EXCEEDS_100';
    throw err;
  }
}

export async function createAutoSplitRule(userId, { productId, planId, splits }) {
  if (!splits || !splits.length) return null;
  const validSplits = splits.filter((s) => {
    const dest = String(s.destination_id ?? '').trim();
    const pct = Number(s.percentage) || 0;
    return dest && pct > 0;
  });
  if (!validSplits.length) return null;
  validateSplitPercentages(validSplits);
  await assertProductNotInAutoTransfer(userId, productId);
  const id = 'rule_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  const p = getPool();
  await p.execute(
    'INSERT INTO auto_split_rules (id, user_id, product_id, plan_id) VALUES (?, ?, ?, ?)',
    [id, userId, productId?.trim() || null, planId?.trim() || null]
  );
  for (const s of validSplits) {
    const dest = String(s.destination_id ?? '').trim();
    const pct = Number(s.percentage) || 0;
    await p.execute(
      'INSERT INTO auto_split_rule_splits (rule_id, destination_id, percentage) VALUES (?, ?, ?)',
      [id, dest, pct]
    );
  }
  const rules = await getAutoSplitRules(userId);
  const created = rules.find((r) => r.id === id);
  return created || { id, productId: productId || null, planId: planId || null, splits: validSplits, createdAt: new Date().toISOString() };
}

export async function deleteAutoSplitRule(ruleId, userId) {
  const [result] = await getPool().execute(
    'DELETE FROM auto_split_rules WHERE id = ? AND user_id = ?',
    [ruleId, userId]
  );
  return result.affectedRows > 0;
}

export async function addProcessedPaymentId(userId, paymentId) {
  const config = await getAutoSplitConfig(userId);
  const ids = [...config.processedPaymentIds, paymentId].slice(-MAX_PROCESSED_IDS);
  await getPool().execute(
    `INSERT INTO auto_split_config (user_id, enabled, processed_payment_ids)
     VALUES (?, 0, ?)
     ON DUPLICATE KEY UPDATE processed_payment_ids = VALUES(processed_payment_ids)`,
    [userId, JSON.stringify(ids)]
  );
}

export async function setAutoSplitProcessedIds(userId, ids) {
  const arr = Array.isArray(ids) ? ids.slice(-MAX_PROCESSED_IDS) : [];
  await getPool().execute(
    `INSERT INTO auto_split_config (user_id, enabled, processed_payment_ids)
     VALUES (?, 0, ?)
     ON DUPLICATE KEY UPDATE processed_payment_ids = VALUES(processed_payment_ids)`,
    [userId, JSON.stringify(arr)]
  );
}

// ——— Auto-transfer config and rules ———
export async function getAutoTransferConfig(userId) {
  const rows = await query(
    'SELECT enabled, processed_payment_ids FROM auto_transfer_config WHERE user_id = ? LIMIT 1',
    [userId]
  );
  if (!rows[0]) return { enabled: false, processedPaymentIds: [] };
  let ids = rows[0].processed_payment_ids;
  if (typeof ids === 'string') {
    try {
      ids = JSON.parse(ids);
    } catch {
      ids = [];
    }
  }
  return {
    enabled: Boolean(rows[0].enabled),
    processedPaymentIds: Array.isArray(ids) ? ids : [],
  };
}

export async function setAutoTransferEnabled(userId, enabled) {
  const p = getPool();
  await p.execute(
    `INSERT INTO auto_transfer_config (user_id, enabled, processed_payment_ids)
     VALUES (?, ?, '[]')
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
    [userId, enabled ? 1 : 0]
  );
}

export async function getAutoTransferRules(userId) {
  const rules = await query(
    `SELECT id, product_id AS productId, plan_id AS planId, destination_id AS destinationId,
            transfer_type AS transferType, value, created_at AS createdAt
     FROM auto_transfer_rules
     WHERE user_id = ?
     ORDER BY created_at ASC`,
    [userId]
  );
  return rules.map((r) => ({
    id: r.id,
    productId: r.productId || null,
    planId: r.planId || null,
    destination_id: r.destinationId,
    transfer_type: r.transferType || 'percentage',
    value: Number(r.value),
    createdAt: r.createdAt,
  }));
}

export async function getFullAutoTransfer(userId) {
  const config = await getAutoTransferConfig(userId);
  const rules = await getAutoTransferRules(userId);
  return {
    enabled: config.enabled,
    rules,
    processedPaymentIds: config.processedPaymentIds,
  };
}

/** Throw if this product is already used in auto-split (mutual exclusivity). */
async function assertProductNotInAutoSplit(userId, productId) {
  const rows = await query(
    'SELECT product_id FROM auto_split_rules WHERE user_id = ?',
    [userId]
  );
  const normalizedNew = (productId && String(productId).trim()) || null;
  for (const r of rows) {
    const existing = r.product_id ?? null;
    if (existing === normalizedNew) {
      const err = new Error('This product is already linked to Auto-split. A product can only be in Auto-split or Auto-transfer, not both.');
      err.code = 'PRODUCT_IN_AUTO_SPLIT';
      throw err;
    }
    if (existing === null) {
      const err = new Error('"Any product" is already used in Auto-split. A product can only be in Auto-split or Auto-transfer, not both.');
      err.code = 'PRODUCT_IN_AUTO_SPLIT';
      throw err;
    }
  }
  if (normalizedNew === null && rows.length > 0) {
    const err = new Error('Cannot add "Any product" while you have Auto-split rules. A product can only be in Auto-split or Auto-transfer, not both.');
    err.code = 'PRODUCT_IN_AUTO_SPLIT';
    throw err;
  }
}

/** Throw if this product is already used in auto-transfer (mutual exclusivity). */
async function assertProductNotInAutoTransfer(userId, productId) {
  const rows = await query(
    'SELECT product_id FROM auto_transfer_rules WHERE user_id = ?',
    [userId]
  );
  const normalizedNew = (productId && String(productId).trim()) || null;
  for (const r of rows) {
    const existing = r.product_id ?? null;
    if (existing === normalizedNew) {
      const err = new Error('This product is already linked to Auto-transfer. A product can only be in Auto-split or Auto-transfer, not both.');
      err.code = 'PRODUCT_IN_AUTO_TRANSFER';
      throw err;
    }
    if (existing === null) {
      const err = new Error('"Any product" is already used in Auto-transfer. A product can only be in Auto-split or Auto-transfer, not both.');
      err.code = 'PRODUCT_IN_AUTO_TRANSFER';
      throw err;
    }
  }
  if (normalizedNew === null && rows.length > 0) {
    const err = new Error('Cannot add "Any product" while you have Auto-transfer rules. A product can only be in Auto-split or Auto-transfer, not both.');
    err.code = 'PRODUCT_IN_AUTO_TRANSFER';
    throw err;
  }
}

export async function createAutoTransferRule(userId, { productId, planId, destination_id, transfer_type, value }) {
  const destId = String(destination_id ?? '').trim();
  if (!destId) return null;
  const typeVal = transfer_type === 'fixed' ? 'fixed' : 'percentage';
  const numVal = Number(value);
  if (!Number.isFinite(numVal) || numVal <= 0) return null;
  if (typeVal === 'percentage' && numVal > 100) return null;
  await assertProductNotInAutoSplit(userId, productId);
  const id = 'atr_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  await getPool().execute(
    'INSERT INTO auto_transfer_rules (id, user_id, product_id, plan_id, destination_id, transfer_type, value) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, userId, productId?.trim() || null, planId?.trim() || null, destId, typeVal, numVal]
  );
  const rules = await getAutoTransferRules(userId);
  return rules.find((r) => r.id === id) || { id, productId: productId || null, planId: planId || null, destination_id: destId, transfer_type: typeVal, value: numVal, createdAt: new Date().toISOString() };
}

export async function deleteAutoTransferRule(ruleId, userId) {
  const [result] = await getPool().execute(
    'DELETE FROM auto_transfer_rules WHERE id = ? AND user_id = ?',
    [ruleId, userId]
  );
  return result.affectedRows > 0;
}

export async function addProcessedPaymentIdAutoTransfer(userId, paymentId) {
  const config = await getAutoTransferConfig(userId);
  const ids = [...config.processedPaymentIds, paymentId].slice(-MAX_PROCESSED_IDS);
  await getPool().execute(
    `INSERT INTO auto_transfer_config (user_id, enabled, processed_payment_ids)
     VALUES (?, 0, ?)
     ON DUPLICATE KEY UPDATE processed_payment_ids = VALUES(processed_payment_ids)`,
    [userId, JSON.stringify(ids)]
  );
}

// ——— Payment job queue (webhooks + catch-up; processed by background worker) ———

const DEFAULT_MAX_JOB_ATTEMPTS = Number(process.env.PAYMENT_JOB_MAX_ATTEMPTS) || 5;

/** Queue a payment for split + auto-transfer processing (idempotent per user/payment). */
export async function enqueuePaymentJob(userId, paymentId) {
  const uid = Number(userId);
  const pid = String(paymentId).trim();
  if (!uid || !pid) {
    return { queued: false, reason: 'invalid' };
  }

  const [insertResult] = await getPool().execute(
    `INSERT INTO payment_jobs (user_id, payment_id, status, max_attempts)
     VALUES (?, ?, 'pending', ?)
     ON DUPLICATE KEY UPDATE
       status = CASE
         WHEN status = 'completed' THEN 'completed'
         WHEN status = 'processing' THEN 'processing'
         WHEN status = 'failed' AND attempts >= max_attempts THEN 'failed'
         ELSE 'pending'
       END,
       last_error = IF(status = 'completed', last_error, NULL),
       updated_at = CURRENT_TIMESTAMP`,
    [uid, pid, DEFAULT_MAX_JOB_ATTEMPTS]
  );

  const rows = await query(
    'SELECT id, status FROM payment_jobs WHERE user_id = ? AND payment_id = ? LIMIT 1',
    [uid, pid]
  );
  const row = rows[0];
  if (!row) return { queued: false, reason: 'insert_failed' };

  const created = insertResult.affectedRows === 1;
  return {
    queued: row.status === 'pending' || row.status === 'processing',
    jobId: row.id,
    status: row.status,
    created,
    alreadyCompleted: row.status === 'completed',
  };
}

/** Re-queue stale jobs stuck in processing (e.g. server crash). */
export async function releaseStalePaymentJobs(staleSeconds = 120) {
  const sec = Math.max(30, Number(staleSeconds) || 120);
  const [result] = await getPool().execute(
    `UPDATE payment_jobs
     SET status = 'pending', locked_until = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE status = 'processing'
       AND (locked_until IS NULL OR locked_until < DATE_SUB(NOW(), INTERVAL ? SECOND))`,
    [sec]
  );
  return result.affectedRows || 0;
}

/** Claim a batch of pending jobs for the worker (atomic). */
export async function claimPendingPaymentJobs(batchSize = 20) {
  const limit = Math.min(Math.max(1, Number(batchSize) || 20), 100);
  const lockSec = Number(process.env.PAYMENT_JOB_LOCK_SECONDS) || 180;

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [candidates] = await connection.execute(
      `SELECT pj.id
       FROM payment_jobs pj
       LEFT JOIN user_settings us ON us.user_id = pj.user_id
       WHERE pj.status = 'pending'
         AND COALESCE(us.worker_enabled, 1) = 1
         AND (
           SELECT COUNT(*)
           FROM payment_jobs pj2
           WHERE pj2.user_id = pj.user_id AND pj2.status = 'processing'
         ) < COALESCE(us.worker_concurrency, 5)
       ORDER BY pj.created_at ASC
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED`
    );
    if (!candidates.length) {
      await connection.commit();
      return [];
    }
    const ids = candidates.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    await connection.execute(
      `UPDATE payment_jobs
       SET status = 'processing',
           attempts = attempts + 1,
           locked_until = DATE_ADD(NOW(), INTERVAL ? SECOND),
           updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${placeholders}) AND status = 'pending'`,
      [lockSec, ...ids]
    );
    const [claimed] = await connection.execute(
      `SELECT id, user_id, payment_id, attempts, max_attempts
       FROM payment_jobs WHERE id IN (${placeholders}) AND status = 'processing'`,
      ids
    );
    await connection.commit();
    return claimed;
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
}

export async function completePaymentJob(jobId, resultJson = null) {
  await getPool().execute(
    `UPDATE payment_jobs
     SET status = 'completed', result_json = ?, locked_until = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [resultJson ? JSON.stringify(resultJson) : null, jobId]
  );
}

export async function failPaymentJob(jobId, errorMessage, requeue = true) {
  const msg = String(errorMessage || 'unknown').slice(0, 2000);
  if (!requeue) {
    await getPool().execute(
      `UPDATE payment_jobs SET status = 'failed', last_error = ?, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [msg, jobId]
    );
    return;
  }
  await getPool().execute(
    `UPDATE payment_jobs
     SET status = IF(attempts >= max_attempts, 'failed', 'pending'),
         last_error = ?,
         locked_until = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [msg, jobId]
  );
}

export async function getPaymentJobQueueStats() {
  const rows = await query(
    `SELECT status, COUNT(*) AS count FROM payment_jobs GROUP BY status`
  );
  const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const r of rows) {
    stats[r.status] = Number(r.count) || 0;
  }
  return stats;
}

/** Pending/processing/failed counts for one user's payment queue. */
export async function getUserPaymentJobStats(userId) {
  const rows = await query(
    `SELECT status, COUNT(*) AS count
     FROM payment_jobs
     WHERE user_id = ?
     GROUP BY status`,
    [userId]
  );
  const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const r of rows) {
    stats[r.status] = Number(r.count) || 0;
  }
  return stats;
}

/** Claim pending jobs for one user (manual "process queue now"). */
export async function claimPendingPaymentJobsForUser(userId, batchSize = 25) {
  const limit = Math.min(Math.max(1, Number(batchSize) || 25), 100);
  const lockSec = Number(process.env.PAYMENT_JOB_LOCK_SECONDS) || 180;
  const uid = Number(userId);

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [candidates] = await connection.execute(
      `SELECT id FROM payment_jobs
       WHERE user_id = ? AND status = 'pending'
       ORDER BY created_at ASC
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED`,
      [uid]
    );
    if (!candidates.length) {
      await connection.commit();
      return [];
    }
    const ids = candidates.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    await connection.execute(
      `UPDATE payment_jobs
       SET status = 'processing',
           attempts = attempts + 1,
           locked_until = DATE_ADD(NOW(), INTERVAL ? SECOND),
           updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${placeholders}) AND status = 'pending'`,
      [lockSec, ...ids]
    );
    const [claimed] = await connection.execute(
      `SELECT id, user_id, payment_id, attempts, max_attempts
       FROM payment_jobs WHERE id IN (${placeholders}) AND status = 'processing'`,
      ids
    );
    await connection.commit();
    return claimed;
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
}

export async function getPaymentJobsByUser() {
  const rows = await query(
    `SELECT
      u.id AS user_id,
      u.email,
      u.active,
      COALESCE(ascfg.enabled, 0) AS auto_split_enabled,
      COALESCE(atcfg.enabled, 0) AS auto_transfer_enabled,
      (SELECT COUNT(*) FROM auto_split_rules r WHERE r.user_id = u.id) AS split_rules,
      (SELECT COUNT(*) FROM auto_transfer_rules r WHERE r.user_id = u.id) AS transfer_rules,
      COALESCE(SUM(pj.status = 'pending'), 0) AS pending,
      COALESCE(SUM(pj.status = 'processing'), 0) AS processing,
      COALESCE(SUM(pj.status = 'completed'), 0) AS completed,
      COALESCE(SUM(pj.status = 'failed'), 0) AS failed,
      COUNT(pj.id) AS total_jobs,
      MAX(pj.updated_at) AS last_job_at
    FROM users u
    LEFT JOIN auto_split_config ascfg ON ascfg.user_id = u.id
    LEFT JOIN auto_transfer_config atcfg ON atcfg.user_id = u.id
    LEFT JOIN payment_jobs pj ON pj.user_id = u.id
    GROUP BY u.id, u.email, u.active, ascfg.enabled, atcfg.enabled
    HAVING total_jobs > 0 OR auto_split_enabled = 1 OR auto_transfer_enabled = 1
       OR split_rules > 0 OR transfer_rules > 0
    ORDER BY (pending + processing) DESC, total_jobs DESC, u.email ASC`
  );
  return rows.map((r) => {
    const completed = Number(r.completed) || 0;
    const failed = Number(r.failed) || 0;
    const finished = completed + failed;
    return {
      userId: r.user_id,
      email: r.email,
      active: Boolean(r.active),
      autoSplitEnabled: Boolean(r.auto_split_enabled),
      autoTransferEnabled: Boolean(r.auto_transfer_enabled),
      splitRules: Number(r.split_rules) || 0,
      transferRules: Number(r.transfer_rules) || 0,
      pending: Number(r.pending) || 0,
      processing: Number(r.processing) || 0,
      completed,
      failed,
      totalJobs: Number(r.total_jobs) || 0,
      completionRate: finished > 0 ? Math.round((completed / finished) * 1000) / 10 : null,
      lastJobAt: r.last_job_at,
    };
  });
}

export async function getPaymentJobsByDay(days = 30) {
  const rows = await query(
    `SELECT DATE(created_at) AS date, status, COUNT(*) AS count
     FROM payment_jobs
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at), status
     ORDER BY date ASC`,
    [days]
  );
  const byDate = new Map();
  for (const r of rows) {
    const d = String(r.date).slice(0, 10);
    if (!byDate.has(d)) {
      byDate.set(d, { date: d, pending: 0, processing: 0, completed: 0, failed: 0 });
    }
    const entry = byDate.get(d);
    entry[r.status] = Number(r.count) || 0;
  }
  return Array.from(byDate.values());
}

export async function getOldestPendingJobAgeSeconds() {
  const [row] = await query(
    `SELECT TIMESTAMPDIFF(SECOND, MIN(created_at), NOW()) AS age
     FROM payment_jobs WHERE status = 'pending'`
  );
  if (row?.age == null) return null;
  return Number(row.age);
}

export async function getPaymentJobsFailedSinceHours(hours = 24) {
  const [row] = await query(
    `SELECT COUNT(*) AS count FROM payment_jobs
     WHERE status = 'failed' AND updated_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)`,
    [hours]
  );
  return Number(row?.count) || 0;
}

function parseMeta(meta) {
  if (meta == null) return {};
  if (typeof meta === 'object') return meta;
  try {
    return JSON.parse(meta);
  } catch {
    return {};
  }
}

export async function getWorkflowMetrics(days = 30) {
  const rows = await query(
    `SELECT user_id, email, action, meta FROM activity_log
     WHERE action IN ('webhook_split', 'webhook_auto_transfer', 'webhook_split_error', 'webhook_enqueue')
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days]
  );

  const global = {
    splitEvents: 0,
    splitRan: 0,
    splitSkipped: 0,
    transferEvents: 0,
    transferSuccess: 0,
    transferWithErrors: 0,
    enqueueEvents: 0,
  };
  const byUser = new Map();

  function userBucket(userId, email) {
    const key = userId ?? 0;
    if (!byUser.has(key)) {
      byUser.set(key, {
        userId: key,
        email: email || null,
        splitEvents: 0,
        splitRan: 0,
        splitSkipped: 0,
        transferEvents: 0,
        transferSuccess: 0,
        transferWithErrors: 0,
        enqueueEvents: 0,
      });
    }
    return byUser.get(key);
  }

  for (const r of rows) {
    const meta = parseMeta(r.meta);
    const u = userBucket(r.user_id, r.email);

    if (r.action === 'webhook_split') {
      global.splitEvents++;
      u.splitEvents++;
      if (meta.ran === true) {
        global.splitRan++;
        u.splitRan++;
      } else {
        global.splitSkipped++;
        u.splitSkipped++;
      }
    } else if (r.action === 'webhook_auto_transfer') {
      global.transferEvents++;
      u.transferEvents++;
      const transfers = Number(meta.transfers) || 0;
      const errors = Number(meta.errors) || 0;
      if (transfers > 0) {
        global.transferSuccess++;
        u.transferSuccess++;
      }
      if (errors > 0) {
        global.transferWithErrors++;
        u.transferWithErrors++;
      }
    } else if (r.action === 'webhook_enqueue') {
      global.enqueueEvents++;
      u.enqueueEvents++;
    }
  }

  const splitRate =
    global.splitEvents > 0 ? Math.round((global.splitRan / global.splitEvents) * 1000) / 10 : null;
  const transferRate =
    global.transferEvents > 0
      ? Math.round((global.transferSuccess / global.transferEvents) * 1000) / 10
      : null;

  const users = Array.from(byUser.values())
    .map((u) => ({
      ...u,
      splitRunRate:
        u.splitEvents > 0 ? Math.round((u.splitRan / u.splitEvents) * 1000) / 10 : null,
      transferSuccessRate:
        u.transferEvents > 0
          ? Math.round((u.transferSuccess / u.transferEvents) * 1000) / 10
          : null,
    }))
    .filter(
      (u) =>
        u.splitEvents > 0 || u.transferEvents > 0 || u.enqueueEvents > 0
    )
    .sort((a, b) => b.transferEvents + b.splitEvents - (a.transferEvents + a.splitEvents));

  return {
    global: {
      ...global,
      splitRunRate: splitRate,
      transferSuccessRate: transferRate,
    },
    byUser: users,
  };
}

export async function getWorkflowEventsByDay(days = 30) {
  const rows = await query(
    `SELECT DATE(created_at) AS date, action, COUNT(*) AS count
     FROM activity_log
     WHERE action IN ('webhook_split', 'webhook_auto_transfer')
       AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at), action
     ORDER BY date ASC`,
    [days]
  );
  const byDate = new Map();
  for (const r of rows) {
    const d = String(r.date).slice(0, 10);
    if (!byDate.has(d)) {
      byDate.set(d, { date: d, split: 0, transfer: 0 });
    }
    const entry = byDate.get(d);
    if (r.action === 'webhook_split') entry.split = Number(r.count) || 0;
    if (r.action === 'webhook_auto_transfer') entry.transfer = Number(r.count) || 0;
  }
  return Array.from(byDate.values());
}

export async function getUserPaymentJobsByDay(userId, days = 30) {
  const rows = await query(
    `SELECT DATE(created_at) AS date, status, COUNT(*) AS count
     FROM payment_jobs
     WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at), status
     ORDER BY date ASC`,
    [userId, days]
  );
  const byDate = new Map();
  for (const r of rows) {
    const d = String(r.date).slice(0, 10);
    if (!byDate.has(d)) {
      byDate.set(d, { date: d, pending: 0, processing: 0, completed: 0, failed: 0 });
    }
    byDate.get(d)[r.status] = Number(r.count) || 0;
  }
  return Array.from(byDate.values());
}

export async function getUserActivityByAction(userId, days = 30) {
  return query(
    `SELECT action, COUNT(*) AS count FROM activity_log
     WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY action ORDER BY count DESC`,
    [userId, days]
  );
}

export async function getUserTransferCreatesByDay(userId, days = 30) {
  return query(
    `SELECT DATE(created_at) AS date, COUNT(*) AS count FROM activity_log
     WHERE user_id = ? AND action = 'transfer_create'
       AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at) ORDER BY date ASC`,
    [userId, days]
  );
}

export async function getUserWorkflowMetrics(userId, days = 30) {
  const rows = await query(
    `SELECT action, meta FROM activity_log
     WHERE user_id = ?
       AND action IN ('webhook_split', 'webhook_auto_transfer', 'webhook_enqueue', 'payment_poll')
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [userId, days]
  );

  const global = {
    splitEvents: 0,
    splitRan: 0,
    splitSkipped: 0,
    transferEvents: 0,
    transferSuccess: 0,
    transferWithErrors: 0,
    enqueueEvents: 0,
    pollEvents: 0,
  };

  for (const r of rows) {
    const meta = parseMeta(r.meta);
    if (r.action === 'webhook_split') {
      global.splitEvents++;
      if (meta.ran === true) global.splitRan++;
      else global.splitSkipped++;
    } else if (r.action === 'webhook_auto_transfer') {
      global.transferEvents++;
      const transfers = Number(meta.transfers) || 0;
      const errors = Number(meta.errors) || 0;
      if (transfers > 0) global.transferSuccess++;
      if (errors > 0) global.transferWithErrors++;
    } else if (r.action === 'webhook_enqueue') {
      global.enqueueEvents++;
    } else if (r.action === 'payment_poll') {
      global.pollEvents++;
    }
  }

  const splitRunRate =
    global.splitEvents > 0 ? Math.round((global.splitRan / global.splitEvents) * 1000) / 10 : null;
  const transferSuccessRate =
    global.transferEvents > 0
      ? Math.round((global.transferSuccess / global.transferEvents) * 1000) / 10
      : null;

  return {
    global: { ...global, splitRunRate, transferSuccessRate },
  };
}

export async function getUserWorkflowEventsByDay(userId, days = 30) {
  const rows = await query(
    `SELECT DATE(created_at) AS date, action, COUNT(*) AS count
     FROM activity_log
     WHERE user_id = ?
       AND action IN ('webhook_split', 'webhook_auto_transfer')
       AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at), action
     ORDER BY date ASC`,
    [userId, days]
  );
  const byDate = new Map();
  for (const r of rows) {
    const d = String(r.date).slice(0, 10);
    if (!byDate.has(d)) {
      byDate.set(d, { date: d, split: 0, transfer: 0 });
    }
    const entry = byDate.get(d);
    if (r.action === 'webhook_split') entry.split = Number(r.count) || 0;
    if (r.action === 'webhook_auto_transfer') entry.transfer = Number(r.count) || 0;
  }
  return Array.from(byDate.values());
}

export async function getUserAppStats(userId, days = 30) {
  let connectedAccountsTotal = 0;
  let autoSplitRulesTotal = 0;
  let autoTransferRulesTotal = 0;
  let transferCreatesInPeriod = 0;
  let autoSplitEnabled = false;
  let autoTransferEnabled = false;
  let processedSplitPayments = 0;
  let processedTransferPayments = 0;

  try {
    const [ca] = await query('SELECT COUNT(*) AS total FROM connected_accounts WHERE user_id = ?', [
      userId,
    ]);
    connectedAccountsTotal = ca?.total ?? 0;
  } catch (_) {}

  try {
    const [asr] = await query('SELECT COUNT(*) AS total FROM auto_split_rules WHERE user_id = ?', [
      userId,
    ]);
    autoSplitRulesTotal = asr?.total ?? 0;
  } catch (_) {}

  try {
    const [atr] = await query('SELECT COUNT(*) AS total FROM auto_transfer_rules WHERE user_id = ?', [
      userId,
    ]);
    autoTransferRulesTotal = atr?.total ?? 0;
  } catch (_) {}

  try {
    const [tc] = await query(
      `SELECT COUNT(*) AS total FROM activity_log
       WHERE user_id = ? AND action = 'transfer_create'
         AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
      [userId, days]
    );
    transferCreatesInPeriod = tc?.total ?? 0;
  } catch (_) {}

  try {
    const splitState = await getFullAutoSplit(userId);
    autoSplitEnabled = Boolean(splitState.enabled);
    processedSplitPayments = splitState.processedPaymentIds?.length ?? 0;
  } catch (_) {}

  try {
    const transferState = await getFullAutoTransfer(userId);
    autoTransferEnabled = Boolean(transferState.enabled);
    processedTransferPayments = transferState.processedPaymentIds?.length ?? 0;
  } catch (_) {}

  return {
    connectedAccountsTotal,
    autoSplitRulesTotal,
    autoTransferRulesTotal,
    transferCreatesInPeriod,
    autoSplitEnabled,
    autoTransferEnabled,
    processedSplitPayments,
    processedTransferPayments,
  };
}

export async function getUserInsights(userId, days = 30) {
  const d = Math.max(1, Math.min(Number(days) || 30, 90));

  const activityByAction = (await getUserActivityByAction(userId, d)).map((r) => ({
    action: r.action,
    count: Number(r.count) || 0,
  }));

  const transferCreatesByDay = (await getUserTransferCreatesByDay(userId, d)).map((r) => ({
    date: String(r.date).slice(0, 10),
    count: Number(r.count) || 0,
  }));

  const appStats = await getUserAppStats(userId, d);

  let queue = {
    global: { pending: 0, processing: 0, completed: 0, failed: 0 },
    byDay: [],
    failedLast24h: 0,
    tableAvailable: true,
  };
  try {
    queue.global = await getUserPaymentJobStats(userId);
    queue.byDay = await getUserPaymentJobsByDay(userId, d);
    const [failRow] = await query(
      `SELECT COUNT(*) AS count FROM payment_jobs
       WHERE user_id = ? AND status = 'failed'
         AND updated_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
      [userId]
    );
    queue.failedLast24h = Number(failRow?.count) || 0;
  } catch (e) {
    queue.tableAvailable = false;
    queue.error = e?.message || 'payment_jobs unavailable';
  }

  const finished = (queue.global.completed || 0) + (queue.global.failed || 0);
  const jobCompletionRate =
    finished > 0 ? Math.round(((queue.global.completed || 0) / finished) * 1000) / 10 : null;

  let workflows = { global: {}, byDay: [] };
  try {
    workflows = await getUserWorkflowMetrics(userId, d);
    workflows.byDay = await getUserWorkflowEventsByDay(userId, d);
  } catch (_) {}

  const recentActivity = await getActivityLogs(40, 0, { userId });
  const settings = await getUserSettings(userId);

  return {
    days: d,
    activityByAction,
    transferCreatesByDay,
    appStats,
    queue: { ...queue, jobCompletionRate },
    workflows,
    recentActivity,
    pollsTotal: settings?.polls_total ?? 0,
    pollEnabled: settings?.poll_enabled !== false,
    workerEnabled: settings?.worker_enabled !== false,
    workerConcurrency: settings?.worker_concurrency ?? 5,
  };
}

/** Extended admin analytics: base stats + queue + workflow metrics. */
export async function getAdminInsights(days = 30) {
  const base = await getAnalyticsStats(days);
  let queue = {
    global: { pending: 0, processing: 0, completed: 0, failed: 0 },
    byUser: [],
    byDay: [],
    oldestPendingSeconds: null,
    failedLast24h: 0,
    tableAvailable: true,
  };
  try {
    queue.global = await getPaymentJobQueueStats();
    queue.byUser = await getPaymentJobsByUser();
    queue.byDay = await getPaymentJobsByDay(days);
    queue.oldestPendingSeconds = await getOldestPendingJobAgeSeconds();
    queue.failedLast24h = await getPaymentJobsFailedSinceHours(24);
  } catch (e) {
    queue.tableAvailable = false;
    queue.error = e?.message || 'payment_jobs unavailable';
  }

  let workflows = {
    global: {
      splitEvents: 0,
      splitRan: 0,
      splitSkipped: 0,
      transferEvents: 0,
      transferSuccess: 0,
      transferWithErrors: 0,
      enqueueEvents: 0,
      splitRunRate: null,
      transferSuccessRate: null,
    },
    byUser: [],
    byDay: [],
  };
  try {
    workflows = await getWorkflowMetrics(days);
    workflows.byDay = await getWorkflowEventsByDay(days);
  } catch (_) {}

  const finished =
    (queue.global.completed || 0) + (queue.global.failed || 0);
  const jobCompletionRate =
    finished > 0
      ? Math.round(((queue.global.completed || 0) / finished) * 1000) / 10
      : null;

  return {
    ...base,
    queue: { ...queue, jobCompletionRate },
    workflows,
  };
}
