/**
 * Whop Admin – Multi-user app: sign up, connect your Whop business, set rules.
 * Data stored in MySQL (users, settings, auto-split per user).
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();
[
  path.join(__dirname, '.env'),
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), '.builds', 'config', '.env'),
  path.join(process.cwd(), '..', '.builds', 'config', '.env'),
].forEach((envPath) => {
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
});

import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import bcrypt from 'bcrypt';
import { Webhook } from 'standardwebhooks';
import * as db from './db.js';
import { encodeWebhookKeyForSdk, ensureEncryptionKey } from './lib/crypto.js';
import {
  ensureSessionSecret,
  isAdminEmailPromotionAllowed,
  isRegistrationAllowed,
  validatePassword,
} from './lib/security.js';
import {
  captureRawBody,
  csrfProtection,
  ensureCsrfToken,
  regenerateSession,
} from './lib/middleware.js';
import { buildSessionOptions } from './lib/session-store.js';
import {
  companyBelongsToParent,
  productBelongsToCompany,
  transferBelongsToCompany,
} from './lib/whop-access.js';
import { getWhop, getWhopCompanyId, getWhopConfig } from './lib/whop-service.js';
import {
  getWorkerConfig,
  getWorkerStatus,
  startPaymentWorker,
  wakePaymentWorker,
  processUserPendingJobs,
} from './lib/payment-worker.js';
import {
  getPollerConfig,
  getPollerStatus,
  startPaymentPoller,
  wakePaymentPoller,
} from './lib/payment-poller.js';
import { doPollUserPayments } from './lib/poll-user-payments.js';
import { collectSystemHealth } from './lib/system-health.js';
import { createAdjustedTransfer, isPermanentTransferError } from './lib/transfer-fees.js';

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';
const USE_SECURE_COOKIES =
  process.env.COOKIE_SECURE === 'true' ||
  (isProduction && process.env.COOKIE_SECURE !== 'false');
const SESSION_SECRET = ensureSessionSecret(isProduction);
ensureEncryptionKey(isProduction);

// Only trust proxy when we know we're behind HTTPS and using secure cookies
if (USE_SECURE_COOKIES) app.set('trust proxy', 1);

const BCRYPT_ROUNDS = 12;

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ? String(process.env.ADMIN_EMAIL).trim().toLowerCase() : '';

function getUserId(req) {
  return req.session?.user?.id ?? null;
}

function getSessionUser(req) {
  return req.session?.user ?? null;
}

function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'Forbidden', message: 'Admin access required.' });
}

function destroySession(req) {
  return new Promise((resolve) => {
    req.session.destroy(() => resolve());
  });
}

async function ensureSessionUser(req) {
  if (!req.session?.user?.id) return { ok: false, reason: 'no_session' };
  const u = await db.getUserById(req.session.user.id);
  if (!u) {
    await destroySession(req);
    return { ok: false, reason: 'user_not_found' };
  }
  if (!u.active) {
    await destroySession(req);
    return { ok: false, reason: 'deactivated' };
  }
  const role = u.role === 'admin' ? 'admin' : 'user';
  if (req.session.user.role !== role) {
    req.session.user.role = role;
  }
  return { ok: true, user: u };
}

async function ensureSessionRole(req) {
  await ensureSessionUser(req);
}

/** Normalize Whop API errors: return { status, message } for response. 502 + friendly message for 4xx auth. */
function normalizeWhopError(err, fallbackMessage) {
  const raw = err?.message || err?.toString?.() || fallbackMessage;
  const isAuthError =
    /not authorized|do not have permission|forbidden|bad_request|access to this resource/i.test(raw) ||
    (typeof raw === 'string' && (raw.includes('"type":"forbidden"') || raw.includes('"type":"bad_request"')));
  if (isAuthError) {
    return {
      status: 502,
      message:
        'Whop rejected the request. Check that your API key and Company ID (Settings or server WHOP_API_KEY / WHOP_PARENT_COMPANY_ID) match the same Whop company and have the right permissions.',
    };
  }
  return { status: 500, message: raw };
}

/** Reserve status for a connected account (ledger + optional company field). */
async function getConnectedAccountReserveInfo(whop, companyId) {
  if (!whop || !companyId) {
    return { has_reserve: false, percentage: null, checked: false };
  }
  try {
    const details = await whop.companies.retrieve(companyId);
    const pct = details?.reserve_percentage;
    if (typeof pct === 'number' && pct > 0) {
      return { has_reserve: true, percentage: pct, checked: true };
    }
  } catch (_) {
    // fall through to ledger balance check
  }
  try {
    const ledger = await whop.ledgerAccounts.retrieve(companyId);
    const balances = Array.isArray(ledger?.balances) ? ledger.balances : [];
    const reserved = balances.filter((b) => Number(b.reserve_balance) > 0);
    if (reserved.length === 0) {
      return { has_reserve: false, percentage: 0, checked: true };
    }
    let maxPct = 0;
    for (const b of reserved) {
      const reserve = Number(b.reserve_balance) || 0;
      const balance = Number(b.balance) || 0;
      const pct = balance > 0 ? Math.round((reserve / balance) * 100) : 0;
      if (pct > maxPct) maxPct = pct;
    }
    return {
      has_reserve: true,
      percentage: maxPct > 0 ? maxPct : null,
      checked: true,
    };
  } catch (_) {
    return { has_reserve: false, percentage: null, checked: false };
  }
}

function formatReserveWarning(info) {
  if (!info?.has_reserve) return null;
  const pct = info.percentage;
  if (typeof pct === 'number' && pct > 0) {
    return `This account has a ${pct}% reserve set by Whop. Auto-transfers will fail until the reserve is removed. Contact Whop support.`;
  }
  return 'Whop has placed a reserve on this account. Auto-transfers will fail until the reserve is removed. Contact Whop support.';
}

async function getConnectedAccountReserveWarning(whop, companyId) {
  const info = await getConnectedAccountReserveInfo(whop, companyId);
  return formatReserveWarning(info);
}

// Security: HTTP headers (X-Content-Type-Options, X-Frame-Options, CSP in production)
app.use(
  helmet({
    contentSecurityPolicy: isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  })
);

// Body parser with size limit; capture raw body for webhook signature verification
app.use(
  express.json({
    limit: '256kb',
    verify: captureRawBody,
  })
);
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

app.use(session(buildSessionOptions(SESSION_SECRET, USE_SECURE_COOKIES)));

// Public assets
app.use(express.static(path.join(__dirname, 'public')));

async function requireAuth(req, res, next) {
  if (!req.session?.user?.id) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Please log in.' });
    }
    return res.redirect('/login');
  }
  try {
    const check = await ensureSessionUser(req);
    if (!check.ok) {
      if (check.reason === 'deactivated') {
        return res.status(403).json({
          error: 'Account deactivated',
          message: 'Your account has been deactivated. Contact an administrator.',
        });
      }
      return res.status(401).json({ error: 'Unauthorized', message: 'Please log in.' });
    }
    return next();
  } catch (e) {
    console.error('requireAuth error:', e?.message);
    return res.status(500).json({ error: 'Server error', message: 'Could not verify session.' });
  }
}

// ——— API router (mounted at /api) ———
const api = express.Router();
api.use(csrfProtection);

api.get('/csrf', (req, res) => {
  const token = ensureCsrfToken(req);
  return res.json({ csrfToken: token });
});

api.get('/me', async (req, res) => {
  if (!req.session?.user?.id) {
    return res.json({ user: null });
  }
  const check = await ensureSessionUser(req);
  if (!check.ok) {
    return res.json({ user: null });
  }
  const u = req.session.user;
  if (u && (u.role === undefined || u.role === null)) {
    u.role = 'user';
  }
  return res.json({ user: u ?? null });
});

api.post('/register', async (req, res) => {
  if (!isRegistrationAllowed()) {
    return res.status(403).json({
      error: 'Registration disabled',
      message: 'Public sign-up is disabled on this server.',
    });
  }
  const { email, password } = req.body || {};
  const e = email != null ? String(email).trim().toLowerCase() : '';
  const p = password != null ? String(password) : '';
  if (!e || !p) {
    return res.status(400).json({ error: 'Missing email or password' });
  }
  const pwCheck = validatePassword(p);
  if (!pwCheck.ok) {
    return res.status(400).json({ error: pwCheck.message });
  }
  try {
    const existing = await db.findUserByEmail(e);
    if (existing) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Could not create account. If you already have an account, try logging in.',
      });
    }
    const role =
      isAdminEmailPromotionAllowed() && ADMIN_EMAIL && e === ADMIN_EMAIL ? 'admin' : 'user';
    const hash = await hashPassword(p);
    const userId = await db.createUser(e, hash, role);
    await db.ensureUserSettings(userId);
    await regenerateSession(req);
    req.session.user = { id: userId, email: e, role };
    await db.insertActivityLog({ userId, email: e, action: 'register', message: 'User signed up' });
    return res.status(201).json({
      ok: true,
      user: { id: userId, email: e, role },
      csrfToken: req.session.csrfToken,
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Server error', message: 'Could not create account.' });
  }
});

api.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const e = email != null ? String(email).trim().toLowerCase() : '';
  const p = password != null ? String(password) : '';
  if (!e || !p) {
    return res.status(400).json({ error: 'Missing email or password' });
  }
  try {
    const user = await db.findUserByEmail(e);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.active) {
      return res.status(403).json({ error: 'Account deactivated', message: 'Your account has been deactivated. Contact an administrator.' });
    }
    const ok = await bcrypt.compare(p, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    let role = user.role === 'admin' ? 'admin' : 'user';
    if (isAdminEmailPromotionAllowed() && ADMIN_EMAIL && e === ADMIN_EMAIL && role !== 'admin') {
      await db.updateUserRole(user.id, 'admin');
      role = 'admin';
    }
    await regenerateSession(req);
    req.session.user = { id: user.id, email: user.email, role };
    await db.insertActivityLog({ userId: user.id, email: user.email, action: 'login', message: 'User logged in' });
    return res.json({
      ok: true,
      user: { id: user.id, email: user.email, role: role || 'user' },
      csrfToken: req.session.csrfToken,
    });
  } catch (_) {
    return res.status(500).json({ error: 'Server error', message: 'Could not verify password.' });
  }
});

api.get('/login', (req, res) => {
  return res.status(405).json({
    error: 'Method Not Allowed',
    message: 'Use POST to log in.',
  });
});

api.post('/logout', async (req, res) => {
  const u = req.session?.user;
  if (u?.id && u?.email) {
    try {
      await db.insertActivityLog({ userId: u.id, email: u.email, action: 'logout', message: 'User logged out' });
    } catch (_) {}
  }
  req.session.destroy(() => {});
  return res.json({ ok: true });
});

api.get('/health', (req, res) => {
  return res.json({ ok: true });
});

// Debug endpoint (no secrets). Disabled in production.
api.get('/debug-env', (req, res) => {
  if (isProduction) return res.status(404).json({ error: 'Not found' });
  return res.json({
    sessionSecretSet: Boolean(process.env.SESSION_SECRET),
    dbHost: process.env.DB_HOST || 'localhost',
    cwd: process.cwd(),
  });
});

// ——— Settings (protected): Whop API key, company ID, webhook URL; change password ———
api.get('/settings', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const config = await getWhopConfig(userId);
  const key = config.apiKey;
  const masked = key ? (key.slice(0, 8) + '…' + key.slice(-4)) : '';
  const settings = await db.getUserSettings(userId);
  const webhookToken = settings?.webhook_token || null;
  const webhookSecretSet = Boolean(settings?.whop_webhook_secret);
  const platformCommissionPct = settings?.platform_commission_pct ?? 1;
  const cachedFeePct = settings?.cached_fee_pct ?? null;
  const pollIntervalSeconds = settings?.poll_interval_seconds ?? 60;
  const pollEnabled = settings?.poll_enabled !== false;
  const pollTickMs = settings?.poll_tick_ms ?? pollIntervalSeconds * 1000;
  const pollParallel = settings?.poll_parallel ?? 5;
  const pollsTotal = settings?.polls_total ?? 0;
  const lastPollAt = settings?.last_poll_at
    ? new Date(settings.last_poll_at).toISOString()
    : null;
  const lastPollError = settings?.last_poll_error ?? null;
  const workerEnabled = settings?.worker_enabled !== false;
  const workerConcurrency = settings?.worker_concurrency ?? 5;
  let workerQueue = { pending: 0, processing: 0, completed: 0, failed: 0 };
  try {
    workerQueue = await db.getUserPaymentJobStats(userId);
  } catch (_) {}
  const baseUrl = process.env.APP_BASE_URL || (process.env.NODE_ENV === 'production' ? '' : `http://localhost:${PORT}`);
  const webhookUrl = webhookToken && baseUrl ? `${baseUrl}/api/webhooks/whop/${webhookToken}` : null;
  return res.json({
    whopApiKeySet: Boolean(key),
    whopCompanyIdSet: Boolean(config.companyId),
    whopApiKeyMasked: masked || null,
    whopCompanyId: config.companyId || null,
    whopWebhookSecretSet: webhookSecretSet,
    adminPasswordSet: true,
    webhookUrl,
    platformCommissionPct,
    cachedFeePct,
    pollIntervalSeconds,
    pollEnabled,
    pollTickMs,
    pollParallel,
    pollsTotal,
    lastPollAt,
    lastPollError,
    workerEnabled,
    workerConcurrency,
    workerQueue,
  });
});

api.put('/settings', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const {
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
    currentPassword,
    newPassword,
  } = req.body || {};

  if (typeof newPassword === 'string' && newPassword.trim()) {
    if (!currentPassword || typeof currentPassword !== 'string') {
      return res.status(400).json({ error: 'Current password is required to set a new password.' });
    }
    const pwCheck = validatePassword(newPassword.trim());
    if (!pwCheck.ok) {
      return res.status(400).json({ error: pwCheck.message });
    }
    const user = await db.getUserById(userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const fullUser = await db.findUserByEmail(user.email);
    if (!fullUser || !(await bcrypt.compare(currentPassword, fullUser.password_hash))) {
      return res.status(401).json({ error: 'Invalid current password.' });
    }
    await db.updateUserPassword(userId, await hashPassword(newPassword.trim()));
  }

  try {
    await db.setUserSettings(userId, {
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
    });
  } catch (err) {
    const message = err?.message || 'Invalid settings';
    return res.status(400).json({ error: message });
  }
  wakePaymentPoller();
  wakePaymentWorker();
  const u = await db.getUserById(userId);
  await db.insertActivityLog({
    userId,
    email: u?.email,
    action: 'settings_update',
    message: 'Whop settings or password updated',
  });
  return res.json({ ok: true, message: 'Settings saved.' });
});

// ——— Whop API (protected, scoped by user) ———
api.get('/companies', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const whop = await getWhop(userId);
  const companyId = await getWhopCompanyId(userId);
  if (!whop || !companyId) return res.json({ data: [] });
  try {
    const page = await whop.companies.list({
      parent_company_id: companyId,
      first: 100,
    });
    const companies = page.data || [];
    const data = await Promise.all(
      companies.map(async (company) => {
        const reserve = await getConnectedAccountReserveInfo(whop, company.id);
        return { ...company, reserve };
      })
    );
    return res.json({ data });
  } catch (err) {
    const { status, message } = normalizeWhopError(err, 'Failed to list companies');
    return res.status(status).json({
      error: status === 502 ? 'Whop rejected request' : 'Whop API error',
      message,
      data: [],
    });
  }
});

api.post('/companies', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const whop = await getWhop(userId);
  const companyId = await getWhopCompanyId(userId);
  if (!whop || !companyId) {
    return res.status(503).json({
      error: 'Server not configured',
      message: 'Set Whop API key and Company ID in Settings',
    });
  }
  try {
    const { email, title, internal_user_id, seller_tier } = req.body;
    if (!email || !title) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'email and title are required',
      });
    }
    const metadata = {};
    if (internal_user_id) metadata.internal_user_id = String(internal_user_id);
    if (seller_tier) metadata.seller_tier = String(seller_tier);

    const company = await whop.companies.create({
      email: String(email).trim(),
      parent_company_id: companyId,
      title: String(title).trim(),
      ...(Object.keys(metadata).length ? { metadata } : {}),
    });

    await db.insertConnectedAccount(userId, {
      companyId: company.id,
      email: company.email || '',
      title: company.title || '',
    });

    let warning = null;
    try {
      warning = await getConnectedAccountReserveWarning(whop, company.id);
    } catch (_) {}

    const u = await db.getUserById(userId);
    await db.insertActivityLog({
      userId,
      email: u?.email,
      action: 'company_create',
      message: warning
        ? `Created company: ${company.title} (reserve detected)`
        : `Created company: ${company.title}`,
      meta: { company_id: company.id, ...(warning ? { reserve_warning: warning } : {}) },
    });

    return res.status(201).json({
      id: company.id,
      email: company.email,
      title: company.title,
      message: 'Connected account created. Use company id to send funds.',
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    const message = err?.message || err?.toString?.() || 'Unknown error';
    const status = err?.statusCode ?? err?.response?.status ?? 500;
    return res.status(typeof status === 'number' ? status : 500).json({
      error: 'Whop API error',
      message,
    });
  }
});

api.patch('/companies/:id', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const whop = await getWhop(userId);
  if (!whop) {
    return res.status(503).json({
      error: 'Server not configured',
      message: 'Set Whop API key and Company ID in Settings',
    });
  }
  const { id } = req.params;
  const companyId = await getWhopCompanyId(userId);
  if (!id) {
    return res.status(400).json({ error: 'Missing company id', message: 'Company ID is required.' });
  }
  if (!(await companyBelongsToParent(whop, companyId, id))) {
    return res.status(403).json({ error: 'Forbidden', message: 'You do not have access to this company.' });
  }
  try {
    const { title, description } = req.body || {};
    const body = {};
    if (title !== undefined) body.title = String(title).trim();
    if (description !== undefined) body.description = description == null ? null : String(description);
    const company = await whop.companies.update(id, body);
    return res.json({
      id: company.id,
      title: company.title,
      description: company.description,
      message: 'Company updated.',
    });
  } catch (err) {
    const message = err?.message || err?.toString?.() || 'Unknown error';
    const status = err?.statusCode ?? err?.response?.status ?? 500;
    return res.status(typeof status === 'number' ? status : 500).json({
      error: 'Whop API error',
      message,
    });
  }
});

api.post('/transfers', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const whop = await getWhop(userId);
  const companyId = await getWhopCompanyId(userId);
  if (!whop || !companyId) {
    return res.status(503).json({
      error: 'Server not configured',
      message: 'Set Whop API key and Company ID in Settings',
    });
  }
  try {
    const { amount, currency, destination_id, metadata, notes } = req.body;
    if (amount == null || !destination_id) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'amount and destination_id are required',
      });
    }
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      return res.status(400).json({
        error: 'Invalid amount',
        message: 'amount must be a positive number',
      });
    }
    const destId = String(destination_id).trim();
    if (!destId) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'destination_id is required',
      });
    }

    const transferPayload = {
      gross: numAmount,
      currency: (currency || 'usd').toLowerCase(),
      originId: companyId,
      destinationId: destId,
      ...(metadata && typeof metadata === 'object' && Object.keys(metadata).length ? { metadata } : {}),
      ...(typeof notes === 'string' && notes.trim().length > 0 ? { notes: notes.trim().slice(0, 50) } : {}),
    };
    const result = await createAdjustedTransfer(whop, userId, transferPayload);

    const u = await db.getUserById(userId);
    await db.insertActivityLog({
      userId,
      email: u?.email,
      action: 'transfer_create',
      message: `Transfer ${result.adjusted} ${result.transfer.currency} to ${destId} (gross ${result.gross})`,
      meta: {
        transfer_id: result.transfer.id,
        gross: result.gross,
        platform_commission: result.platformCommission,
        sendable: result.sendable,
        adjusted: result.adjusted,
        fee_pct: result.feePct,
      },
    });

    return res.status(201).json({
      id: result.transfer.id,
      amount: result.transfer.amount,
      currency: result.transfer.currency,
      destination_id: result.transfer.destination_id,
      gross: result.gross,
      platform_commission: result.platformCommission,
      sendable: result.sendable,
      adjusted: result.adjusted,
      fee_pct: result.feePct,
      message: 'Transfer created successfully.',
    });
  } catch (err) {
    const message = err?.message || err?.toString?.() || 'Unknown error';
    if (isPermanentTransferError(err)) {
      return res.status(400).json({
        error: 'Transfer amount too small',
        message,
      });
    }
    const status = err?.statusCode ?? err?.response?.status ?? 500;
    return res.status(typeof status === 'number' ? status : 500).json({
      error: 'Whop API error',
      message,
    });
  }
});

// ——— Whop API: Transfers (transactions) ———
api.get('/transfers', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const whop = await getWhop(userId);
  const companyId = await getWhopCompanyId(userId);
  if (!whop || !companyId) {
    return res.status(503).json({
      error: 'Whop API not configured',
      message: 'Set Whop API key and Company ID in Settings',
      data: [],
    });
  }
  try {
    const page = await whop.transfers.list({
      origin_id: companyId,
      first: 100,
      order: 'created_at',
      direction: 'desc',
    });
    const items = page.getPaginatedItems ? page.getPaginatedItems() : [];
    const data = items.map((t) => ({
      id: t.id,
      amount: t.amount,
      currency: t.currency,
      created_at: t.created_at,
      origin_ledger_account_id: t.origin_ledger_account_id,
      destination_ledger_account_id: t.destination_ledger_account_id,
      fee_amount: t.fee_amount,
      notes: t.notes,
      metadata: t.metadata,
    }));
    return res.json({ data });
  } catch (err) {
    const { status, message } = normalizeWhopError(err, 'Failed to list transfers');
    return res.status(status).json({
      error: status === 502 ? 'Whop rejected request' : 'Whop API error',
      message,
      data: [],
    });
  }
});

// ——— Whop API: Members (customers) ———
api.get('/members', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const whop = await getWhop(userId);
  const companyId = await getWhopCompanyId(userId);
  if (!whop || !companyId) {
    return res.status(503).json({
      error: 'Whop API not configured',
      message: 'Set Whop API key and Company ID in Settings',
      data: [],
    });
  }
  try {
    const page = await whop.members.list({
      company_id: companyId,
      first: 100,
    });
    const items = page.getPaginatedItems ? page.getPaginatedItems() : [];
    const data = items.map((m) => ({
      id: m.id,
      access_level: m.access_level,
      status: m.status,
      created_at: m.created_at,
      joined_at: m.joined_at,
      updated_at: m.updated_at,
      usd_total_spent: m.usd_total_spent,
      company_token_balance: m.company_token_balance,
      most_recent_action: m.most_recent_action,
      most_recent_action_at: m.most_recent_action_at,
      user: m.user
        ? {
            id: m.user.id,
            username: m.user.username,
            name: m.user.name,
            email: m.user.email,
          }
        : null,
    }));
    return res.json({ data });
  } catch (err) {
    const { status, message } = normalizeWhopError(err, 'Failed to list members');
    return res.status(status).json({
      error: status === 502 ? 'Whop rejected request' : 'Whop API error',
      message,
      data: [],
    });
  }
});

api.get('/transfers/:id', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const whop = await getWhop(userId);
  const companyId = await getWhopCompanyId(userId);
  if (!whop) {
    return res.status(503).json({
      error: 'Whop API not configured',
      message: 'Set Whop API key and Company ID in Settings',
    });
  }
  try {
    const transfer = await whop.transfers.retrieve(req.params.id);
    if (!transferBelongsToCompany(transfer, companyId)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Transfer not found.' });
    }
    return res.json({
      id: transfer.id,
      amount: transfer.amount,
      currency: transfer.currency,
      created_at: transfer.created_at,
      origin_ledger_account_id: transfer.origin_ledger_account_id,
      destination_ledger_account_id: transfer.destination_ledger_account_id,
      fee_amount: transfer.fee_amount,
      notes: transfer.notes,
      metadata: transfer.metadata,
    });
  } catch (err) {
    const message = err?.message || err?.toString?.() || 'Transfer not found';
    const status = err?.statusCode ?? err?.response?.status ?? 404;
    return res.status(typeof status === 'number' ? status : 404).json({
      error: 'Whop API error',
      message,
    });
  }
});

// ——— Whop API: Products ———
api.get('/products', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const whop = await getWhop(userId);
  const companyId = await getWhopCompanyId(userId);
  if (!whop || !companyId) {
    return res.status(503).json({
      error: 'Whop API not configured',
      message: 'Set Whop API key and Company ID in Settings',
      data: [],
    });
  }
  try {
    const page = await whop.products.list({
      company_id: companyId,
      first: 100,
    });
    const items = page.getPaginatedItems ? page.getPaginatedItems() : [];
    const data = items.map((p) => ({
      id: p.id,
      title: p.title,
      headline: p.headline,
      route: p.route,
      created_at: p.created_at,
      updated_at: p.updated_at,
      member_count: p.member_count,
      published_reviews_count: p.published_reviews_count,
      visibility: p.visibility,
      verified: p.verified,
      external_identifier: p.external_identifier,
    }));
    return res.json({ data });
  } catch (err) {
    const { status, message } = normalizeWhopError(err, 'Failed to list products');
    return res.status(status).json({
      error: status === 502 ? 'Whop rejected request' : 'Whop API error',
      message,
      data: [],
    });
  }
});

api.get('/products/:id', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const whop = await getWhop(userId);
  const companyId = await getWhopCompanyId(userId);
  if (!whop) {
    return res.status(503).json({
      error: 'Whop API not configured',
      message: 'Set Whop API key and Company ID in Settings',
    });
  }
  try {
    const product = await whop.products.retrieve(req.params.id);
    if (!productBelongsToCompany(product, companyId)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Product not found.' });
    }
    return res.json({
      id: product.id,
      title: product.title,
      headline: product.headline,
      route: product.route,
      created_at: product.created_at,
      updated_at: product.updated_at,
      member_count: product.member_count,
      visibility: product.visibility,
      verified: product.verified,
    });
  } catch (err) {
    const message = err?.message || err?.toString?.() || 'Product not found';
    const status = err?.statusCode ?? err?.response?.status ?? 404;
    return res.status(typeof status === 'number' ? status : 404).json({
      error: 'Whop API error',
      message,
    });
  }
});

// Split rules API (protected, per user)
api.get('/split-rules', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const config = await db.getAutoSplitConfig(userId);
  const rules = await db.getAutoSplitRules(userId);
  return res.json({ enabled: config.enabled, rules });
});

api.patch('/split-rules', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const { enabled } = req.body ?? {};
  if (typeof enabled === 'boolean') {
    await db.setAutoSplitEnabled(userId, enabled);
  }
  const config = await db.getAutoSplitConfig(userId);
  const rules = await db.getAutoSplitRules(userId);
  return res.json({ enabled: config.enabled, rules });
});

api.post('/split-rules', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const { productId, planId, splits, batch_enabled, batch_per_amount } = req.body ?? {};
  if (!Array.isArray(splits) || splits.length === 0) {
    return res.status(400).json({ error: 'Invalid request', message: 'splits array is required and must not be empty.' });
  }
  let rule;
  try {
    rule = await db.createAutoSplitRule(userId, {
      productId: productId?.trim() || null,
      planId: planId?.trim() || null,
      splits: splits.map((s) => ({
        destination_id: String(s.destination_id ?? '').trim(),
        percentage: Number(s.percentage) || 0,
      })),
      batch_enabled: Boolean(batch_enabled),
      batch_per_amount:
        batch_per_amount != null && batch_per_amount !== '' ? Number(batch_per_amount) : null,
    });
  } catch (e) {
    if (e?.code === 'PRODUCT_IN_AUTO_TRANSFER') {
      return res.status(409).json({ error: 'Conflict', message: e.message, code: e.code });
    }
    if (e?.code === 'SPLIT_PERCENTAGE_EXCEEDS_100') {
      return res.status(400).json({ error: 'Invalid request', message: e.message, code: e.code });
    }
    if (e?.code === 'INVALID_BATCH_AMOUNT') {
      return res.status(400).json({ error: 'Invalid request', message: e.message, code: e.code });
    }
    throw e;
  }
  if (!rule || !rule.splits?.length) {
    return res.status(400).json({ error: 'Invalid request', message: 'At least one split with destination_id and percentage is required.' });
  }
  const u = await db.getUserById(userId);
  await db.insertActivityLog({
    userId,
    email: u?.email,
    action: 'split_rule_create',
    message: `Auto-split rule created`,
    meta: { rule_id: rule.id },
  });
  return res.status(201).json(rule);
});

api.delete('/split-rules/:id', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const deleted = await db.deleteAutoSplitRule(req.params.id, userId);
  if (!deleted) {
    return res.status(404).json({ error: 'Not found', message: 'Rule not found.' });
  }
  const u = await db.getUserById(userId);
  await db.insertActivityLog({
    userId,
    email: u?.email,
    action: 'split_rule_delete',
    message: `Auto-split rule deleted`,
    meta: { rule_id: req.params.id },
  });
  const rules = await db.getAutoSplitRules(userId);
  return res.json({ ok: true, rules });
});

// ——— Auto-transfer API (protected, per user) ———
api.get('/auto-transfer', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  try {
    const state = await db.getFullAutoTransfer(userId);
    return res.json({
      enabled: state.enabled,
      rules: state.rules,
      processedPaymentIds: (state.processedPaymentIds || []).slice(-500),
    });
  } catch (e) {
    const msg = e?.message || 'Failed to load auto-transfer config';
    console.error('GET /api/auto-transfer failed:', msg);
    const missingTable = /auto_transfer|doesn't exist|ER_NO_SUCH_TABLE|Unknown table/i.test(msg);
    return res.status(missingTable ? 503 : 500).json({
      error: missingTable ? 'Not configured' : 'Server error',
      message: missingTable
        ? 'Auto-transfer tables are missing. Run scripts/migrate-auto-transfer.sql'
        : msg,
      enabled: false,
      rules: [],
      processedPaymentIds: [],
    });
  }
});

api.patch('/auto-transfer', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const { enabled } = req.body ?? {};
  if (typeof enabled === 'boolean') {
    await db.setAutoTransferEnabled(userId, enabled);
  }
  const config = await db.getAutoTransferConfig(userId);
  const rules = await db.getAutoTransferRules(userId);
  return res.json({ enabled: config.enabled, rules });
});

api.post('/auto-transfer/rules', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const { productId, planId, destination_id, transfer_type, value, batch_enabled, batch_per_amount } =
    req.body ?? {};
  const destId = String(destination_id ?? '').trim();
  if (!destId) {
    return res.status(400).json({ error: 'Invalid request', message: 'destination_id is required.' });
  }
  let rule;
  try {
    rule = await db.createAutoTransferRule(userId, {
      productId: productId?.trim() || null,
      planId: planId?.trim() || null,
      destination_id: destId,
      transfer_type: transfer_type === 'fixed' ? 'fixed' : 'percentage',
      value: Number(value) || 0,
      batch_enabled: Boolean(batch_enabled),
      batch_per_amount:
        batch_per_amount != null && batch_per_amount !== '' ? Number(batch_per_amount) : null,
    });
  } catch (e) {
    if (e?.code === 'PRODUCT_IN_AUTO_SPLIT') {
      return res.status(409).json({ error: 'Conflict', message: e.message, code: e.code });
    }
    if (e?.code === 'INVALID_BATCH_AMOUNT') {
      return res.status(400).json({ error: 'Invalid request', message: e.message, code: e.code });
    }
    throw e;
  }
  if (!rule) {
    return res.status(400).json({ error: 'Invalid request', message: 'value must be a positive number (and ≤ 100 for percentage).' });
  }
  const u = await db.getUserById(userId);
  await db.insertActivityLog({
    userId,
    email: u?.email,
    action: 'auto_transfer_rule_create',
    message: 'Auto-transfer rule created',
    meta: { rule_id: rule.id },
  });
  return res.status(201).json(rule);
});

api.delete('/auto-transfer/rules/:id', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const deleted = await db.deleteAutoTransferRule(req.params.id, userId);
  if (!deleted) {
    return res.status(404).json({ error: 'Not found', message: 'Rule not found.' });
  }
  const u = await db.getUserById(userId);
  await db.insertActivityLog({
    userId,
    email: u?.email,
    action: 'auto_transfer_rule_delete',
    message: 'Auto-transfer rule deleted',
    meta: { rule_id: req.params.id },
  });
  const rules = await db.getAutoTransferRules(userId);
  return res.json({ ok: true, rules });
});

// Process pending payment queue for current user (POST /api/process-queue)
api.post('/process-queue', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  try {
    const result = await processUserPendingJobs(userId, { manual: true });
    const u = await db.getUserById(userId);
    await db.insertActivityLog({
      userId,
      email: u?.email,
      action: 'payment_worker',
      message: result.message || `Processed ${result.processed} queued payment(s)`,
      meta: {
        processed: result.processed,
        failed: result.failed,
        pending: result.pending,
        errors: result.errors?.length ?? 0,
      },
    });
    return res.json(result);
  } catch (err) {
    const message = err?.message || err?.toString?.() || 'Process queue failed';
    return res.status(500).json({ error: 'Process queue error', message });
  }
});

// Manual poll — same logic as background poller (POST /api/poll)
api.post('/poll', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  try {
    const result = await doPollUserPayments(userId, { manual: true });
    const u = await db.getUserById(userId);
    await db.insertActivityLog({
      userId,
      email: u?.email,
      action: 'payment_poll',
      message: result.firstPoll
        ? 'First poll: recorded start time'
        : `Poll queued ${result.queued}, skipped ${result.skipped}`,
      meta: {
        queued: result.queued,
        skipped: result.skipped,
        firstPoll: result.firstPoll,
        errors: result.errors?.length ?? 0,
      },
    });
    if (!result.ok && result.reason === 'not_configured') {
      return res.status(503).json({
        error: 'Server not configured',
        message: 'Set Whop API key and Company ID in Settings',
        ...result,
      });
    }
    return res.json(result);
  } catch (err) {
    const message = err?.message || err?.toString?.() || 'Poll failed';
    return res.status(500).json({ error: 'Poll error', message });
  }
});

// Process recent payments for auto-transfer (catch-up)
api.post('/process-payments-auto-transfer', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  try {
    const result = await doPollUserPayments(userId, { fullScan: true, manual: true });
    if (result.reason === 'not_configured') {
      return res.status(503).json({
        error: 'Server not configured',
        message: 'Set Whop API key and Company ID in Settings',
      });
    }
    return res.json({
      queued: result.queued,
      skipped: result.skipped,
      errors: result.errors,
      message: result.message || 'Payments queued for background processing.',
    });
  } catch (err) {
    const message = err?.message || err?.toString?.() || 'Failed to list payments';
    return res.status(500).json({ error: 'Whop API error', message });
  }
});

// Webhook: Whop payment.succeeded — URL token routes to user; signature verified with per-user webhook secret
api.post('/webhooks/whop/:token', async (req, res) => {
  const token = req.params.token;
  const user = await db.getUserByWebhookToken(token);
  if (!user) {
    try {
      await db.insertActivityLog({ action: 'webhook_unknown_token', message: 'Webhook received with unknown token', meta: { token_prefix: token.slice(0, 8) } });
    } catch (_) {}
    return res.status(404).json({ received: true, error: 'Unknown webhook token' });
  }

  const settings = await db.getUserSettings(user.id);
  const webhookSecret = settings?.whop_webhook_secret?.trim() || '';
  if (!webhookSecret) {
    return res.status(503).json({
      received: false,
      error: 'Webhook secret not configured',
      message: 'Add your Whop webhook secret in Settings before accepting webhooks.',
    });
  }

  const rawBody =
    req.rawBody != null
      ? Buffer.isBuffer(req.rawBody)
        ? req.rawBody.toString('utf8')
        : String(req.rawBody)
      : JSON.stringify(req.body || {});

  let body;
  try {
    const verifier = new Webhook(encodeWebhookKeyForSdk(webhookSecret));
    body = verifier.verify(rawBody, req.headers);
  } catch (err) {
    console.error('Webhook signature verification failed:', err?.message);
    try {
      await db.insertActivityLog({
        userId: user.id,
        action: 'webhook_invalid_signature',
        message: 'Webhook rejected: invalid signature',
      });
    } catch (_) {}
    return res.status(401).json({ received: false, error: 'Invalid webhook signature' });
  }

  const type = body?.type || body?.action;
  const u = await db.getUserById(user.id);
  try {
    await db.insertActivityLog({
      userId: user.id,
      email: u?.email,
      action: 'webhook_received',
      message: type === 'payment.succeeded' ? 'Payment succeeded webhook' : `Webhook: ${type || 'unknown'}`,
      meta: type ? { type, payment_id: body?.data?.payment?.id || body?.data?.id } : null,
    });
  } catch (_) {}
  if (type !== 'payment.succeeded') {
    return res.status(200).json({ received: true });
  }
  const paymentId = body?.data?.payment?.id || body?.data?.id;
  if (!paymentId) {
    return res.status(200).json({ received: true });
  }
  try {
    const queued = await db.enqueuePaymentJob(user.id, paymentId);
    wakePaymentWorker();
    return res.status(200).json({
      received: true,
      queued: queued.queued,
      jobId: queued.jobId,
      status: queued.status,
      alreadyCompleted: queued.alreadyCompleted ?? false,
    });
  } catch (e) {
    console.error('Webhook enqueue error:', e);
    try {
      await db.insertActivityLog({
        userId: user.id,
        email: u?.email,
        action: 'webhook_enqueue_error',
        message: e?.message || 'Failed to queue payment',
        meta: { payment_id: paymentId },
      });
    } catch (_) {}
    return res.status(500).json({ received: true, error: e?.message });
  }
});

// Process recent payments (catch-up)
api.post('/process-payments', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  try {
    const result = await doPollUserPayments(userId, { fullScan: true, manual: true });
    if (result.reason === 'not_configured') {
      return res.status(503).json({
        error: 'Server not configured',
        message: 'Set Whop API key and Company ID in Settings',
      });
    }
    return res.json({
      queued: result.queued,
      skipped: result.skipped,
      errors: result.errors,
      message: result.message || 'Payments queued for background processing.',
    });
  } catch (err) {
    const message = err?.message || err?.toString?.() || 'Failed to list payments';
    return res.status(500).json({ error: 'Whop API error', message });
  }
});

// List payments (for UI)
api.get('/payments', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const whop = await getWhop(userId);
  const companyId = await getWhopCompanyId(userId);
  if (!whop || !companyId) {
    return res.status(503).json({ data: [], message: 'Whop not configured' });
  }
  try {
    const page = await whop.payments.list({
      company_id: companyId,
      first: 50,
      order: 'paid_at',
      direction: 'desc',
    });
    const items = page.getPaginatedItems ? page.getPaginatedItems() : [];
    const data = items.map((p) => ({
      id: p.id,
      status: p.status,
      amount_after_fees: p.amount_after_fees,
      total: p.total,
      currency: p.currency,
      paid_at: p.paid_at,
      created_at: p.created_at,
      product: p.product ? { id: p.product.id, title: p.product.title } : null,
      plan: p.plan ? { id: p.plan.id } : null,
    }));
    const state = await db.getFullAutoSplit(userId);
    return res.json({
      data,
      processedPaymentIds: state.processedPaymentIds.slice(-500),
    });
  } catch (err) {
    return res.status(500).json({
      data: [],
      message: err?.message || 'Failed to list payments',
    });
  }
});

// ——— Admin (requireAuth + requireAdmin) ———
api.get('/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await db.listUsers();
    const users = rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      active: Boolean(r.active),
      created_at: r.created_at,
    }));
    return res.json({ data: users });
  } catch (err) {
    console.error('Admin users list error:', err);
    return res.status(500).json({ error: 'Server error', message: 'Could not list users.' });
  }
});

api.patch('/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  const { role, active } = req.body || {};
  if (!targetId || isNaN(targetId)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const target = await db.getUserById(targetId);
  if (!target) {
    return res.status(404).json({ error: 'Not found', message: 'User not found.' });
  }
  const adminUser = getSessionUser(req);
  if (targetId === adminUser?.id && active === false) {
    return res.status(400).json({ error: 'Cannot deactivate yourself', message: 'You cannot deactivate your own account.' });
  }
  try {
    if (role === 'admin' || role === 'user') {
      await db.updateUserRole(targetId, role);
      await db.insertActivityLog({
        userId: adminUser?.id,
        email: adminUser?.email,
        action: 'admin_role_change',
        message: `Role set to ${role} for ${target?.email ?? targetId}`,
        meta: { target_user_id: targetId, new_role: role },
      });
    }
    if (typeof active === 'boolean') {
      await db.updateUserActive(targetId, active);
      await db.insertActivityLog({
        userId: adminUser?.id,
        email: adminUser?.email,
        action: active ? 'admin_user_activated' : 'admin_user_deactivated',
        message: `${target?.email ?? targetId} ${active ? 'activated' : 'deactivated'}`,
        meta: { target_user_id: targetId },
      });
    }
    const updatedUser = await db.getUserById(targetId);
    return res.json({
      ok: true,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
        active: Boolean(updatedUser.active),
      },
    });
  } catch (err) {
    console.error('Admin user update error:', err);
    return res.status(500).json({ error: 'Server error', message: 'Could not update user.' });
  }
});

api.get('/admin/logs', requireAuth, requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const filters = {
    userId: req.query.user_id != null ? req.query.user_id : undefined,
    email: req.query.email != null ? String(req.query.email).trim() || undefined : undefined,
    from: req.query.from != null ? String(req.query.from).trim() || undefined : undefined,
    to: req.query.to != null ? String(req.query.to).trim() || undefined : undefined,
    action: req.query.action != null ? String(req.query.action).trim() || undefined : undefined,
  };
  try {
    const logs = await db.getActivityLogs(limit, offset, filters);
    return res.json({ data: logs });
  } catch (err) {
    console.error('Admin logs error:', err);
    return res.status(500).json({ error: 'Server error', message: 'Could not load logs.' });
  }
});

api.get('/admin/queue', requireAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await db.getPaymentJobQueueStats();
    return res.json({ stats, worker: getWorkerConfig() });
  } catch (err) {
    console.error('Admin queue stats error:', err);
    return res.status(500).json({ error: 'Server error', message: 'Could not load queue stats.' });
  }
});

api.get('/analytics', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const days = Math.min(Number(req.query.days) || 30, 90);
  try {
    const stats = await db.getUserInsights(userId, days);
    return res.json(stats);
  } catch (err) {
    console.error('User analytics error:', err);
    return res.status(500).json({ error: 'Server error', message: 'Could not load analytics.' });
  }
});

api.get('/admin/analytics', requireAuth, requireAdmin, async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 90);
  try {
    const stats = await db.getAdminInsights(days);
    stats.worker = getWorkerConfig();
    stats.workerStatus = getWorkerStatus();
    return res.json(stats);
  } catch (err) {
    console.error('Admin analytics error:', err);
    return res.status(500).json({ error: 'Server error', message: 'Could not load analytics.' });
  }
});

api.get('/admin/health', requireAuth, requireAdmin, async (req, res) => {
  try {
    const health = await collectSystemHealth();
    return res.json(health);
  } catch (err) {
    console.error('Admin health error:', err);
    return res.status(500).json({ error: 'Server error', message: 'Could not load system health.' });
  }
});

// Mount API router at /api (all routes above are now under /api/...)
app.use('/api', api);

// ——— Serve React SPA (only frontend) ———
const clientDist = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: serve index.html for non-API, non-asset GET requests
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/assets/')) {
      return res.status(404).json({ error: 'Not found', path: req.path });
    }
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) res.status(404).send('Not found');
    });
  });
} else {
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Not found', path: req.path });
    }
    res.status(503).send('Frontend not built. Run: npm run build (in client/)');
  });
  console.log('  (No client/dist — run "npm run build" in client/)');
}

async function start() {
  try {
    await db.query('SELECT 1');
    console.log('Database connected');
    try {
      const purged = await db.purgeActivityLogsOlderThan();
      if (purged > 0) {
        console.log(`Activity log: purged ${purged} row(s) older than retention window`);
      }
    } catch (e) {
      console.warn('Activity log retention purge skipped:', e?.message);
    }
  } catch (e) {
    console.error('Database connection failed:', e?.message);
    console.error('Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME and run scripts/init-db.sql');
    process.exit(1);
  }
  startPaymentWorker();
  startPaymentPoller();

  const server = app.listen(PORT, () => {
    console.log(`Whop Admin running at http://localhost:${PORT}`);
    console.log(`  Sign up / Login: http://localhost:${PORT}/login`);
    console.log(`  After login: http://localhost:${PORT}/connected-accounts`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Set PORT in .env (e.g. PORT=3002).`);
      process.exit(1);
    }
    throw err;
  });
}

start();
