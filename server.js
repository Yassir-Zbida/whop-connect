/**
 * Whop Admin – Express app with admin login and Whop connected accounts (enroll & send funds).
 * All connected-accounts and API routes require login.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from multiple possible locations; later files override earlier
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
import Whop from '@whop/sdk';
const app = express();
const PORT = process.env.PORT || 3001;

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ? String(process.env.ADMIN_PASSWORD).trim() : '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'whop-admin-secret-change-in-production';
const WHOP_API_KEY = process.env.WHOP_API_KEY;
const WHOP_PARENT_COMPANY_ID = process.env.WHOP_PARENT_COMPANY_ID;

if (!ADMIN_PASSWORD) {
  console.warn('Set ADMIN_PASSWORD in .env for admin login.');
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
  })
);

// Public assets
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Please log in.' });
  }
  return res.redirect('/login');
}

// ——— API router (mounted at /api so all routes are under /api/*) ———
const api = express.Router();

api.get('/me', (req, res) => {
  return res.json({ user: req.session?.user ?? null });
});

api.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = username != null ? String(username).trim() : '';
  const p = password != null ? String(password) : '';
  if (!u || !p) {
    return res.status(400).json({ error: 'Missing username or password' });
  }
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Server misconfigured', message: 'ADMIN_PASSWORD is not set. Add .env and restart the app.' });
  }
  if (u === ADMIN_USERNAME && p === ADMIN_PASSWORD) {
    req.session.user = { username: ADMIN_USERNAME };
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Invalid username or password' });
});

api.get('/login', (req, res) => {
  return res.status(405).json({
    error: 'Method Not Allowed',
    message: 'Use POST to log in. If you see this, the request may have been redirected or proxied as GET.',
  });
});

api.post('/logout', (req, res) => {
  req.session.destroy(() => {});
  return res.json({ ok: true });
});

api.get('/health', (req, res) => {
  return res.json({ ok: true });
});

// Debug endpoint: env/path status only (no secrets). Remove or restrict in production if desired.
api.get('/debug-env', (req, res) => {
  const hostingerEnvPath = path.join(process.cwd(), '.builds', 'config', '.env');
  const rootEnvPath = path.join(process.cwd(), '.env');
  return res.json({
    adminPasswordSet: Boolean(process.env.ADMIN_PASSWORD),
    adminUsername: process.env.ADMIN_USERNAME || '(default: admin)',
    sessionSecretSet: Boolean(process.env.SESSION_SECRET),
    whopApiKeySet: Boolean(process.env.WHOP_API_KEY),
    whopCompanyIdSet: Boolean(process.env.WHOP_PARENT_COMPANY_ID),
    cwd: process.cwd(),
    hostingerEnvPath,
    hostingerEnvExists: fs.existsSync(hostingerEnvPath),
    rootEnvExists: fs.existsSync(rootEnvPath),
  });
});

// ——— Whop API (protected) ———
const whop =
  WHOP_API_KEY && WHOP_PARENT_COMPANY_ID
    ? new Whop({ apiKey: WHOP_API_KEY })
    : null;

api.get('/companies', requireAuth, async (req, res) => {
  if (!whop) {
    return res.json({ data: [] });
  }
  try {
    const page = await whop.companies.list({
      parent_company_id: WHOP_PARENT_COMPANY_ID,
      first: 100,
    });
    return res.json({ data: page.data || [] });
  } catch (_) {
    return res.json({ data: [] });
  }
});

api.post('/companies', requireAuth, async (req, res) => {
  if (!whop) {
    return res.status(503).json({
      error: 'Server not configured',
      message: 'Set WHOP_API_KEY and WHOP_PARENT_COMPANY_ID in .env',
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
      parent_company_id: WHOP_PARENT_COMPANY_ID,
      title: String(title).trim(),
      ...(Object.keys(metadata).length ? { metadata } : {}),
    });

    return res.status(201).json({
      id: company.id,
      email: company.email,
      title: company.title,
      message: 'Connected account created. Use company id to send funds.',
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
  if (!whop) {
    return res.status(503).json({
      error: 'Server not configured',
      message: 'Set WHOP_API_KEY and WHOP_PARENT_COMPANY_ID in .env',
    });
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'Missing company id', message: 'Company ID is required.' });
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
  if (!whop) {
    return res.status(503).json({
      error: 'Server not configured',
      message: 'Set WHOP_API_KEY and WHOP_PARENT_COMPANY_ID in .env',
    });
  }
  try {
    const { amount, currency, destination_id, metadata } = req.body;
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

    const transfer = await whop.transfers.create({
      amount: numAmount,
      currency: (currency || 'usd').toLowerCase(),
      origin_id: WHOP_PARENT_COMPANY_ID,
      destination_id: String(destination_id).trim(),
      ...(metadata && typeof metadata === 'object' && Object.keys(metadata).length
        ? { metadata }
        : {}),
    });

    return res.status(201).json({
      id: transfer.id,
      amount: transfer.amount,
      currency: transfer.currency,
      destination_id: transfer.destination_id,
      message: 'Transfer created successfully.',
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

// ——— Whop API: Transfers (transactions) ———
api.get('/transfers', requireAuth, async (req, res) => {
  if (!whop) {
    return res.status(503).json({
      error: 'Whop API not configured',
      message: 'Set WHOP_API_KEY and WHOP_PARENT_COMPANY_ID in .env',
      data: [],
    });
  }
  try {
    const page = await whop.transfers.list({
      origin_id: WHOP_PARENT_COMPANY_ID,
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
    const message = err?.message || err?.toString?.() || 'Failed to list transfers';
    return res.status(500).json({
      error: 'Whop API error',
      message,
      data: [],
    });
  }
});

// ——— Whop API: Members (customers) ———
api.get('/members', requireAuth, async (req, res) => {
  if (!whop) {
    return res.status(503).json({
      error: 'Whop API not configured',
      message: 'Set WHOP_API_KEY and WHOP_PARENT_COMPANY_ID in .env',
      data: [],
    });
  }
  try {
    const page = await whop.members.list({
      company_id: WHOP_PARENT_COMPANY_ID,
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
    const message = err?.message || err?.toString?.() || 'Failed to list members';
    return res.status(500).json({
      error: 'Whop API error',
      message,
      data: [],
    });
  }
});

api.get('/transfers/:id', requireAuth, async (req, res) => {
  if (!whop) {
    return res.status(503).json({
      error: 'Whop API not configured',
      message: 'Set WHOP_API_KEY and WHOP_PARENT_COMPANY_ID in .env',
    });
  }
  try {
    const transfer = await whop.transfers.retrieve(req.params.id);
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
  if (!whop) {
    return res.status(503).json({
      error: 'Whop API not configured',
      message: 'Set WHOP_API_KEY and WHOP_PARENT_COMPANY_ID in .env',
      data: [],
    });
  }
  try {
    const page = await whop.products.list({
      company_id: WHOP_PARENT_COMPANY_ID,
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
    const message = err?.message || err?.toString?.() || 'Failed to list products';
    return res.status(500).json({
      error: 'Whop API error',
      message,
      data: [],
    });
  }
});

api.get('/products/:id', requireAuth, async (req, res) => {
  if (!whop) {
    return res.status(503).json({
      error: 'Whop API not configured',
      message: 'Set WHOP_API_KEY and WHOP_PARENT_COMPANY_ID in .env',
    });
  }
  try {
    const product = await whop.products.retrieve(req.params.id);
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

// ——— Auto-split workflow (persist rules + processed payment IDs) ———
const DATA_DIR = path.join(__dirname, 'data');
const AUTO_SPLIT_FILE = path.join(DATA_DIR, 'auto-split.json');
const MAX_PROCESSED_IDS = 50000;

function readAutoSplit() {
  try {
    if (fs.existsSync(AUTO_SPLIT_FILE)) {
      const raw = fs.readFileSync(AUTO_SPLIT_FILE, 'utf8');
      const data = JSON.parse(raw);
      return {
        enabled: Boolean(data.enabled),
        rules: Array.isArray(data.rules) ? data.rules : [],
        processedPaymentIds: Array.isArray(data.processedPaymentIds) ? data.processedPaymentIds : [],
      };
    }
  } catch (e) {
    console.warn('auto-split read error:', e?.message);
  }
  return { enabled: false, rules: [], processedPaymentIds: [] };
}

function writeAutoSplit(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const toWrite = {
      enabled: data.enabled,
      rules: data.rules,
      processedPaymentIds: (data.processedPaymentIds || []).slice(-MAX_PROCESSED_IDS),
    };
    fs.writeFileSync(AUTO_SPLIT_FILE, JSON.stringify(toWrite, null, 2), 'utf8');
  } catch (e) {
    console.warn('auto-split write error:', e?.message);
    throw e;
  }
}

async function runSplitForPayment(paymentId) {
  const state = readAutoSplit();
  if (state.processedPaymentIds.includes(paymentId)) return { ran: false, reason: 'already_processed' };
  if (!whop || !WHOP_PARENT_COMPANY_ID) return { ran: false, reason: 'not_configured' };
  if (!state.enabled || state.rules.length === 0) return { ran: false, reason: 'disabled_or_no_rules' };

  let payment;
  try {
    payment = await whop.payments.retrieve(paymentId);
  } catch (e) {
    return { ran: false, reason: 'payment_fetch_failed', message: e?.message };
  }

  const status = payment?.status;
  if (status !== 'paid') return { ran: false, reason: 'payment_not_paid', status };

  const productId = payment?.product?.id ?? null;
  const planId = payment?.plan?.id ?? null;
  const amountRaw = payment?.amount_after_fees ?? payment?.total ?? payment?.usd_total ?? 0;
  const amount = Number(amountRaw);
  const currency = (payment?.currency || 'usd').toLowerCase();
  if (!amount || amount <= 0) return { ran: false, reason: 'invalid_amount' };

  const matchingRules = state.rules.filter((r) => {
    if (r.productId && r.productId !== productId) return false;
    if (r.planId != null && r.planId !== '' && r.planId !== planId) return false;
    return true;
  });
  if (matchingRules.length === 0) return { ran: false, reason: 'no_matching_rule', productId, planId };

  const transfersCreated = [];
  const errors = [];
  for (const rule of matchingRules) {
    for (const split of rule.splits || []) {
      const pct = Number(split.percentage);
      const destId = split.destination_id?.trim();
      if (!destId || !Number.isFinite(pct) || pct <= 0) continue;
      const splitAmount = Math.round((amount * pct) / 100 * 100) / 100;
      if (splitAmount < 0.01) continue;
      try {
        const transfer = await whop.transfers.create({
          amount: splitAmount,
          currency,
          origin_id: WHOP_PARENT_COMPANY_ID,
          destination_id: destId,
          metadata: { payment_id: paymentId, product_id: productId || '', rule_id: rule.id || '', percentage: pct },
        });
        transfersCreated.push({ transfer_id: transfer.id, destination_id: destId, amount: splitAmount, percentage: pct });
      } catch (e) {
        errors.push({ destination_id: destId, message: e?.message || String(e) });
      }
    }
  }

  state.processedPaymentIds.push(paymentId);
  writeAutoSplit(state);
  return { ran: true, transfersCreated, errors };
}

// Split rules API (protected)
api.get('/split-rules', requireAuth, (req, res) => {
  const state = readAutoSplit();
  return res.json({
    enabled: state.enabled,
    rules: state.rules,
  });
});

api.patch('/split-rules', requireAuth, (req, res) => {
  const state = readAutoSplit();
  const { enabled } = req.body ?? {};
  if (typeof enabled === 'boolean') state.enabled = enabled;
  writeAutoSplit(state);
  return res.json({ enabled: state.enabled, rules: state.rules });
});

api.post('/split-rules', requireAuth, (req, res) => {
  const state = readAutoSplit();
  const { productId, planId, splits } = req.body ?? {};
  if (!Array.isArray(splits) || splits.length === 0) {
    return res.status(400).json({ error: 'Invalid request', message: 'splits array is required and must not be empty.' });
  }
  const id = 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  const rule = {
    id,
    productId: productId?.trim() || null,
    planId: planId?.trim() || null,
    splits: splits.map((s) => ({
      destination_id: String(s.destination_id ?? '').trim(),
      percentage: Number(s.percentage) || 0,
    })).filter((s) => s.destination_id && s.percentage > 0),
    createdAt: new Date().toISOString(),
  };
  if (rule.splits.length === 0) {
    return res.status(400).json({ error: 'Invalid request', message: 'At least one split with destination_id and percentage is required.' });
  }
  state.rules.push(rule);
  writeAutoSplit(state);
  return res.status(201).json(rule);
});

api.delete('/split-rules/:id', requireAuth, (req, res) => {
  const state = readAutoSplit();
  const before = state.rules.length;
  state.rules = state.rules.filter((r) => r.id !== req.params.id);
  if (state.rules.length === before) {
    return res.status(404).json({ error: 'Not found', message: 'Rule not found.' });
  }
  writeAutoSplit(state);
  return res.json({ ok: true, rules: state.rules });
});

// Webhook: Whop payment.succeeded (no auth; verify with WHOP_WEBHOOK_SECRET if set)
api.post('/webhooks/whop', async (req, res) => {
  const body = req.body || {};
  const type = body?.type || body?.action;
  if (type !== 'payment.succeeded') {
    return res.status(200).json({ received: true });
  }
  const paymentId = body?.data?.payment?.id || body?.data?.id;
  if (!paymentId) {
    return res.status(200).json({ received: true });
  }
  try {
    const result = await runSplitForPayment(paymentId);
    return res.status(200).json({ received: true, ...result });
  } catch (e) {
    console.error('Webhook split error:', e);
    return res.status(500).json({ received: true, error: e?.message });
  }
});

// Process recent payments (catch-up): list paid payments and run split for any not yet processed
api.post('/process-payments', requireAuth, async (req, res) => {
  if (!whop || !WHOP_PARENT_COMPANY_ID) {
    return res.status(503).json({
      error: 'Server not configured',
      message: 'Set WHOP_API_KEY and WHOP_PARENT_COMPANY_ID in .env',
    });
  }
  const state = readAutoSplit();
  const processed = new Set(state.processedPaymentIds);
  const results = { processed: 0, skipped: 0, errors: [] };
  try {
    const page = await whop.payments.list({
      company_id: WHOP_PARENT_COMPANY_ID,
      first: 100,
      order: 'paid_at',
      direction: 'desc',
    });
    const items = page.getPaginatedItems ? page.getPaginatedItems() : [];
    for (const p of items) {
      if (p.status !== 'paid' || processed.has(p.id)) {
        results.skipped++;
        continue;
      }
      try {
        const result = await runSplitForPayment(p.id);
        if (result.ran) results.processed++;
      } catch (e) {
        results.errors.push({ payment_id: p.id, message: e?.message });
      }
    }
    return res.json(results);
  } catch (err) {
    const message = err?.message || err?.toString?.() || 'Failed to list payments';
    return res.status(500).json({
      error: 'Whop API error',
      message,
      ...results,
    });
  }
});

// List payments (for UI)
api.get('/payments', requireAuth, async (req, res) => {
  if (!whop || !WHOP_PARENT_COMPANY_ID) {
    return res.status(503).json({ data: [], message: 'Whop not configured' });
  }
  try {
    const page = await whop.payments.list({
      company_id: WHOP_PARENT_COMPANY_ID,
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
    const state = readAutoSplit();
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

const server = app.listen(PORT, () => {
  console.log(`Whop Admin running at http://localhost:${PORT}`);
  console.log(`  Login: http://localhost:${PORT}/login`);
  console.log(`  Connected accounts (after login): http://localhost:${PORT}/connected-accounts`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process or set PORT in .env (e.g. PORT=3002).`);
    process.exit(1);
  }
  throw err;
});
