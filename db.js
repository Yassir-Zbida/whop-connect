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
export async function insertActivityLog({ userId = null, email = null, action, message = '', meta = null }) {
  await getPool().execute(
    'INSERT INTO activity_log (user_id, email, action, message, meta) VALUES (?, ?, ?, ?, ?)',
    [userId, email || null, String(action).slice(0, 128), String(message).slice(0, 512), meta ? JSON.stringify(meta) : null]
  );
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
  return {
    whop_api_key: decryptSetting(row.whop_api_key),
    whop_company_id: row.whop_company_id || '',
    whop_webhook_secret: decryptSetting(row.whop_webhook_secret),
    webhook_token: row.webhook_token || '',
  };
}

// ——— User settings (Whop API key, company ID, webhook token, webhook secret) ———
export async function getUserSettings(userId) {
  const rows = await query(
    'SELECT whop_api_key, whop_company_id, whop_webhook_secret, webhook_token FROM user_settings WHERE user_id = ? LIMIT 1',
    [userId]
  );
  return normalizeSettingsRow(rows[0]) || null;
}

export async function setUserSettings(userId, { whopApiKey, whopCompanyId, whopWebhookSecret }) {
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

  let apiKeyStored = raw?.whop_api_key ?? '';
  if (whopApiKey !== undefined) {
    apiKeyStored = apiKeyPlain ? encryptSetting(apiKeyPlain) : '';
  }
  let webhookSecretStored = raw?.whop_webhook_secret ?? '';
  if (whopWebhookSecret !== undefined) {
    webhookSecretStored = webhookSecretPlain ? encryptSetting(webhookSecretPlain) : '';
  }

  await p.execute(
    `INSERT INTO user_settings (user_id, whop_api_key, whop_company_id, whop_webhook_secret, webhook_token)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       whop_api_key = VALUES(whop_api_key),
       whop_company_id = VALUES(whop_company_id),
       whop_webhook_secret = IF(VALUES(whop_webhook_secret) != '', VALUES(whop_webhook_secret), whop_webhook_secret),
       webhook_token = IF(COALESCE(webhook_token, '') = '', VALUES(webhook_token), webhook_token)`,
    [userId, apiKeyStored, companyId, webhookSecretStored, webhookToken]
  );
  return {
    whopApiKey: apiKeyPlain,
    whopCompanyId: companyId,
    whopWebhookSecret: webhookSecretPlain,
    webhookToken,
  };
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

export async function createAutoSplitRule(userId, { productId, planId, splits }) {
  if (!splits || !splits.length) return null;
  const validSplits = splits.filter((s) => {
    const dest = String(s.destination_id ?? '').trim();
    const pct = Number(s.percentage) || 0;
    return dest && pct > 0;
  });
  if (!validSplits.length) return null;
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
