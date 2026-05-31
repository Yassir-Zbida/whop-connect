import { logApiRequest, logApiResponse } from './utils/logger';

const BASE = '';

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export async function fetchCsrfToken(): Promise<string> {
  const res = await fetch(BASE + '/api/csrf', { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.csrfToken) {
    throw new Error('Could not load security token');
  }
  csrfToken = data.csrfToken as string;
  return csrfToken;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase();
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (isMutation && !csrfToken) {
    await fetchCsrfToken();
  }
  logApiRequest(method, path);
  const start = Date.now();
  const res = await fetch(BASE + path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(isMutation && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...options?.headers,
    },
  });
  const durationMs = Date.now() - start;
  const data = await res.json().catch(() => ({}));
  const success = res.ok;
  const errorMessage = getErrorMessage(data);
  logApiResponse(method, path, res.status, success, durationMs, success ? undefined : { error: errorMessage });
  if (res.status === 401) throw new Error('Unauthorized');
  if (!res.ok) throw new Error(errorMessage);
  return data as T;
}

/** Extract a user-friendly message from API error responses (e.g. { error: { message: "..." } } or { message: "..." }). */
function getErrorMessage(data: unknown): string {
  if (data == null || typeof data !== 'object') return 'Request failed';
  const obj = data as Record<string, unknown>;
  if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim();
  const err = obj.error;
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err != null && typeof err === 'object' && typeof (err as Record<string, unknown>).message === 'string') {
    const msg = (err as { message: string }).message.trim();
    if (msg) return msg;
  }
  return 'Request failed';
}

export type User = { id: number; email: string; role?: 'user' | 'admin' };

export async function getMe(): Promise<{ user: User | null } | null> {
  try {
    return await request<{ user: User | null }>('/api/me');
  } catch {
    return null;
  }
}

export async function register(
  email: string,
  password: string
): Promise<{ ok: boolean; user: User; csrfToken?: string }> {
  const res = await request<{ ok: boolean; user: User; csrfToken?: string }>('/api/register', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  if (res.csrfToken) setCsrfToken(res.csrfToken);
  return res;
}

export async function login(
  email: string,
  password: string
): Promise<{ ok: boolean; user: User; csrfToken?: string }> {
  const res = await request<{ ok: boolean; user: User; csrfToken?: string }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  if (res.csrfToken) setCsrfToken(res.csrfToken);
  return res;
}

export async function logout(): Promise<void> {
  if (!csrfToken) await fetchCsrfToken();
  await fetch(BASE + '/api/logout', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
  });
  setCsrfToken(null);
}

export type CompanyReserve = {
  has_reserve: boolean;
  percentage: number | null;
  checked: boolean;
};

export async function getCompanies(): Promise<{
  data: Array<{ id: string; title?: string; owner_user?: { username?: string }; reserve?: CompanyReserve }>;
}> {
  return request('/api/companies');
}

export async function createCompany(body: { email: string; title: string; internal_user_id?: string; seller_tier?: string }): Promise<{ id: string; warning?: string }> {
  return request<{ id: string; warning?: string }>('/api/companies', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateCompany(id: string, body: { title?: string; description?: string }): Promise<{ id: string; title?: string; message: string }> {
  return request<{ id: string; title?: string; message: string }>(`/api/companies/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export type LedgerBalance = {
  currency: string;
  balance: number;
  pending_balance: number;
  reserve_balance: number;
  transferable: number;
};

export async function getBalance(currency = 'usd'): Promise<LedgerBalance> {
  const params = new URLSearchParams({ currency: currency.toLowerCase() });
  return request<LedgerBalance>(`/api/balance?${params}`);
}

export async function getTransfers(): Promise<{ data: Transfer[]; error?: string; message?: string }> {
  const res = await fetch(BASE + '/api/transfers', { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { message?: string }).message || (data as { error?: string }).error || 'Failed to load transfers');
  }
  return data as { data: Transfer[]; error?: string; message?: string };
}

export type Transfer = {
  id: string;
  amount: number;
  currency: string;
  created_at: string;
  origin_ledger_account_id?: string;
  destination_ledger_account_id?: string;
  fee_amount?: number | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function getTransfer(id: string): Promise<Transfer> {
  return request<Transfer>(`/api/transfers/${encodeURIComponent(id)}`);
}

export async function getProducts(): Promise<{ data: Product[]; error?: string; message?: string }> {
  const res = await fetch(BASE + '/api/products', { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { message?: string }).message || (data as { error?: string }).error || 'Failed to load products');
  }
  return data as { data: Product[]; error?: string; message?: string };
}

export type Product = {
  id: string;
  title?: string;
  headline?: string | null;
  route?: string;
  created_at?: string;
  updated_at?: string;
  member_count?: number;
  published_reviews_count?: number;
  visibility?: string;
  verified?: boolean;
  external_identifier?: string | null;
};

export async function getProduct(id: string): Promise<Product> {
  return request<Product>(`/api/products/${encodeURIComponent(id)}`);
}

export async function getMembers(): Promise<{ data: Member[]; error?: string; message?: string }> {
  const res = await fetch(BASE + '/api/members', { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { message?: string }).message || (data as { error?: string }).error || 'Failed to load members');
  }
  return data as { data: Member[]; error?: string; message?: string };
}

export type Member = {
  id: string;
  access_level?: string;
  status?: string;
  created_at?: string;
  joined_at?: string;
  updated_at?: string;
  usd_total_spent?: number;
  company_token_balance?: number;
  most_recent_action?: string | null;
  most_recent_action_at?: string | null;
  user?: {
    id: string;
    username?: string;
    name?: string | null;
    email?: string | null;
  } | null;
};

export async function createTransfer(body: {
  amount: number;
  currency?: string;
  destination_id: string;
  metadata?: { order_id?: string; batch_transfer?: boolean; batch_index?: number; batch_total?: number };
  notes?: string;
}): Promise<{
  id: string;
  amount?: number;
  currency?: string;
  destination_id?: string;
  gross?: number;
  platform_commission?: number;
  sendable?: number;
  adjusted?: number;
  fee_pct?: number;
  message?: string;
}> {
  return request('/api/transfers', { method: 'POST', body: JSON.stringify(body) });
}

// ——— Auto-split workflow ———
export type SplitRule = {
  id: string;
  productId: string | null;
  planId: string | null;
  splits: Array<{ destination_id: string; percentage: number }>;
  batch_enabled?: boolean;
  batch_per_amount?: number | null;
  createdAt: string;
};

export async function getSplitRules(): Promise<{ enabled: boolean; rules: SplitRule[] }> {
  return request<{ enabled: boolean; rules: SplitRule[] }>('/api/split-rules');
}

export async function updateSplitRulesEnabled(enabled: boolean): Promise<{ enabled: boolean; rules: SplitRule[] }> {
  return request<{ enabled: boolean; rules: SplitRule[] }>('/api/split-rules', {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export async function createSplitRule(body: {
  productId?: string | null;
  planId?: string | null;
  splits: Array<{ destination_id: string; percentage: number }>;
  batch_enabled?: boolean;
  batch_per_amount?: number | null;
}): Promise<SplitRule> {
  return request<SplitRule>('/api/split-rules', { method: 'POST', body: JSON.stringify(body) });
}

export async function deleteSplitRule(id: string): Promise<{ ok: boolean; rules: SplitRule[] }> {
  return request<{ ok: boolean; rules: SplitRule[] }>(`/api/split-rules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export type PaymentSummary = {
  id: string;
  status: string;
  amount_after_fees: number;
  total: number | null;
  currency: string;
  paid_at: string | null;
  created_at: string;
  product: { id: string; title?: string } | null;
  plan: { id: string } | null;
};

export async function getPayments(): Promise<{
  data: PaymentSummary[];
  processedPaymentIds: string[];
}> {
  return request<{ data: PaymentSummary[]; processedPaymentIds: string[] }>('/api/payments');
}

export async function processPayments(): Promise<{
  queued: number;
  skipped: number;
  errors: Array<{ payment_id: string; message: string }>;
  message?: string;
}> {
  return request<{
    queued: number;
    skipped: number;
    errors: Array<{ payment_id: string; message: string }>;
    message?: string;
  }>('/api/process-payments', { method: 'POST' });
}

// ——— Auto-transfer workflow ———
export type AutoTransferRule = {
  id: string;
  productId: string | null;
  planId: string | null;
  destination_id: string;
  transfer_type: 'percentage' | 'fixed';
  value: number;
  batch_enabled?: boolean;
  batch_per_amount?: number | null;
  createdAt: string;
};

export async function getAutoTransfer(): Promise<{
  enabled: boolean;
  rules: AutoTransferRule[];
  processedPaymentIds: string[];
}> {
  return request<{ enabled: boolean; rules: AutoTransferRule[]; processedPaymentIds: string[] }>('/api/auto-transfer');
}

export async function updateAutoTransferEnabled(enabled: boolean): Promise<{ enabled: boolean; rules: AutoTransferRule[] }> {
  return request<{ enabled: boolean; rules: AutoTransferRule[] }>('/api/auto-transfer', {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export async function createAutoTransferRule(body: {
  productId?: string | null;
  planId?: string | null;
  destination_id: string;
  transfer_type: 'percentage' | 'fixed';
  value: number;
  batch_enabled?: boolean;
  batch_per_amount?: number | null;
}): Promise<AutoTransferRule> {
  return request<AutoTransferRule>('/api/auto-transfer/rules', { method: 'POST', body: JSON.stringify(body) });
}

export async function deleteAutoTransferRule(id: string): Promise<{ ok: boolean; rules: AutoTransferRule[] }> {
  return request<{ ok: boolean; rules: AutoTransferRule[] }>(`/api/auto-transfer/rules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function processPaymentsAutoTransfer(): Promise<{
  queued: number;
  skipped: number;
  errors: Array<{ payment_id: string; message: string }>;
  message?: string;
}> {
  return request<{
    queued: number;
    skipped: number;
    errors: Array<{ payment_id: string; message: string }>;
    message?: string;
  }>('/api/process-payments-auto-transfer', { method: 'POST' });
}

// ——— Settings ———
export type Settings = {
  whopApiKeySet: boolean;
  whopCompanyIdSet: boolean;
  whopApiKeyMasked: string | null;
  whopCompanyId: string | null;
  whopWebhookSecretSet?: boolean;
  adminPasswordSet: boolean;
  webhookUrl?: string | null;
  platformCommissionPct?: number;
  cachedFeePct?: number | null;
  pollIntervalSeconds?: number;
  pollEnabled?: boolean;
  pollTickMs?: number;
  pollParallel?: number;
  pollsTotal?: number;
  lastPollAt?: string | null;
  lastPollError?: string | null;
  workerEnabled?: boolean;
  workerConcurrency?: number;
  workerQueue?: { pending: number; processing: number; completed: number; failed: number };
};

export async function getSettings(): Promise<Settings> {
  return request<Settings>('/api/settings');
}

export async function pollPaymentsNow(): Promise<{
  ok: boolean;
  reason?: string;
  queued: number;
  skipped: number;
  errors: Array<{ payment_id: string | null; message: string }>;
  firstPoll?: boolean;
  message?: string;
  lastPollAt?: string | null;
  pollsTotal?: number;
}> {
  return request('/api/poll', { method: 'POST' });
}

export async function processPaymentQueueNow(): Promise<{
  ok: boolean;
  reason?: string;
  processed: number;
  failed: number;
  pending: number;
  processing?: number;
  errors: Array<{ jobId?: number; message: string }>;
  message?: string;
}> {
  return request('/api/process-queue', { method: 'POST' });
}

export async function updateSettings(body: {
  whopApiKey?: string;
  whopCompanyId?: string;
  whopWebhookSecret?: string;
  platformCommissionPct?: number;
  pollIntervalSeconds?: number;
  pollEnabled?: boolean;
  pollTickMs?: number;
  pollParallel?: number;
  workerEnabled?: boolean;
  workerConcurrency?: number;
  currentPassword?: string;
  newPassword?: string;
}): Promise<{ ok: boolean; message?: string }> {
  return request<{ ok: boolean; message?: string }>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

// ——— Admin (requires role === 'admin') ———
export type AdminUser = { id: number; email: string; role: string; active?: boolean; created_at: string };

export async function getAdminUsers(): Promise<{ data: AdminUser[] }> {
  return request<{ data: AdminUser[] }>('/api/admin/users');
}

export async function updateUserActive(userId: number, active: boolean): Promise<{ ok: boolean; user: AdminUser }> {
  return request<{ ok: boolean; user: AdminUser }>(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ active }),
  });
}

export type ActivityLogEntry = {
  id: number;
  user_id: number | null;
  email: string | null;
  action: string;
  message: string;
  meta: Record<string, unknown> | null;
  created_at: string;
};

export type AdminLogsFilters = {
  user_id?: number;
  email?: string;
  from?: string;
  to?: string;
  action?: string;
};

export type QueueUserStats = {
  userId: number;
  email: string;
  active: boolean;
  autoSplitEnabled: boolean;
  autoTransferEnabled: boolean;
  splitRules: number;
  transferRules: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  totalJobs: number;
  completionRate: number | null;
  lastJobAt: string | null;
};

export type WorkflowUserMetrics = {
  userId: number;
  email: string | null;
  splitEvents: number;
  splitRan: number;
  splitSkipped: number;
  transferEvents: number;
  transferSuccess: number;
  transferWithErrors: number;
  enqueueEvents: number;
  splitRunRate: number | null;
  transferSuccessRate: number | null;
};

export type AdminAnalytics = {
  period?: string;
  useHourly?: boolean;
  days?: number | null;
  usersTotal: number;
  signupsByDay: Array<{ date: string; count: number }>;
  activityByAction: Array<{ action: string; count: number }>;
  loginsByDay: Array<{ date: string; count: number }>;
  appStats?: {
    connectedAccountsTotal: number;
    autoSplitRulesTotal: number;
    autoTransferRulesTotal: number;
    transferCreatesInPeriod: number;
  };
  transferCreatesByDay?: Array<{ date: string; count: number }>;
  queue?: {
    global: { pending: number; processing: number; completed: number; failed: number };
    byUser: QueueUserStats[];
    byDay: Array<{ date: string; pending: number; processing: number; completed: number; failed: number }>;
    oldestPendingSeconds: number | null;
    failedLast24h: number;
    jobCompletionRate: number | null;
    tableAvailable?: boolean;
    error?: string;
  };
  workflows?: {
    global: {
      splitEvents: number;
      splitRan: number;
      splitSkipped: number;
      transferEvents: number;
      transferSuccess: number;
      transferWithErrors: number;
      enqueueEvents: number;
      splitRunRate: number | null;
      transferSuccessRate: number | null;
    };
    byUser: WorkflowUserMetrics[];
    byDay: Array<{ date: string; split: number; transfer: number }>;
  };
  worker?: {
    enabled: boolean;
    pollMs: number;
    batchSize: number;
    globalConcurrency: number;
    staleSeconds: number;
  };
  workerStatus?: {
    pollTimerActive: boolean;
    batchRunning: boolean;
    wakePending: boolean;
  };
};

export type HealthCheck = {
  id: string;
  name: string;
  status: 'healthy' | 'degraded' | 'warning' | 'critical';
  message: string;
  details?: Record<string, unknown>;
};

export type SystemHealth = {
  status: 'healthy' | 'degraded' | 'critical';
  timestamp: string;
  uptimeSeconds: number;
  nodeEnv: string;
  checks: HealthCheck[];
  queue: { pending: number; processing: number; completed: number; failed: number } | null;
  worker: Record<string, unknown>;
  encryptionConfigured: boolean;
  failedJobs24h: number;
};

export async function getAdminAnalytics(period?: string): Promise<AdminAnalytics> {
  const params = period != null ? `?period=${encodeURIComponent(period)}` : '';
  return request<AdminAnalytics>(`/api/admin/analytics${params}`);
}

export type UserAnalytics = {
  period?: string;
  useHourly?: boolean;
  days?: number | null;
  activityByAction: Array<{ action: string; count: number }>;
  transferCreatesByDay: Array<{ date: string; count: number }>;
  appStats: {
    connectedAccountsTotal: number;
    autoSplitRulesTotal: number;
    autoTransferRulesTotal: number;
    transferCreatesInPeriod: number;
    autoSplitEnabled: boolean;
    autoTransferEnabled: boolean;
    processedSplitPayments: number;
    processedTransferPayments: number;
  };
  queue: {
    global: { pending: number; processing: number; completed: number; failed: number };
    byDay: Array<{ date: string; pending: number; processing: number; completed: number; failed: number }>;
    failedLast24h: number;
    jobCompletionRate: number | null;
    periodCompleted?: number;
    periodFailed?: number;
    hasWorkflows?: boolean;
    tableAvailable?: boolean;
    error?: string;
  };
  workflows: {
    global: {
      splitEvents: number;
      splitRan: number;
      splitSkipped: number;
      transferEvents: number;
      transferSuccess: number;
      transferWithErrors: number;
      enqueueEvents: number;
      pollEvents: number;
      splitRunRate: number | null;
      transferSuccessRate: number | null;
    };
    byDay: Array<{ date: string; split: number; transfer: number }>;
  };
  recentActivity: Array<{
    id: number;
    user_id: number | null;
    email: string | null;
    action: string;
    message: string;
    meta: Record<string, unknown> | null;
    created_at: string;
  }>;
  pollsTotal: number;
  pollEnabled: boolean;
};

export async function getUserAnalytics(period?: string): Promise<UserAnalytics> {
  const params = period != null ? `?period=${encodeURIComponent(period)}` : '';
  return request<UserAnalytics>(`/api/analytics${params}`);
}

export async function getAdminHealth(): Promise<SystemHealth> {
  return request<SystemHealth>('/api/admin/health');
}

export async function getAdminLogs(
  limit?: number,
  offset?: number,
  filters?: AdminLogsFilters
): Promise<{ data: ActivityLogEntry[] }> {
  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  if (filters?.user_id != null) params.set('user_id', String(filters.user_id));
  if (filters?.email?.trim()) params.set('email', filters.email.trim());
  if (filters?.from?.trim()) params.set('from', filters.from.trim());
  if (filters?.to?.trim()) params.set('to', filters.to.trim());
  if (filters?.action?.trim()) params.set('action', filters.action.trim());
  const q = params.toString();
  return request<{ data: ActivityLogEntry[] }>(`/api/admin/logs${q ? `?${q}` : ''}`);
}

export async function updateUserRole(userId: number, role: 'user' | 'admin'): Promise<{ ok: boolean; user: AdminUser }> {
  return request<{ ok: boolean; user: AdminUser }>(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export async function updateAdminUser(userId: number, data: { role?: 'user' | 'admin'; active?: boolean }): Promise<{ ok: boolean; user: AdminUser }> {
  return request<{ ok: boolean; user: AdminUser }>(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}
