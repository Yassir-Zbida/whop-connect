const SIMPLE_KEY = 'whop-admin:simple-transfer-draft';
const BULK_KEY = 'whop-admin:bulk-transfer-draft';

const CURRENCIES = new Set(['usd', 'eur', 'gbp', 'sgd']);

export type SimpleTransferDraft = {
  destinationId: string;
  amount: string;
  currency: string;
  notes: string;
};

export type BulkTransferDraft = {
  destinationId: string;
  totalAmount: string;
  perAmount: string;
  currency: string;
  notes: string;
};

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

function normalizeCurrency(value: unknown): string {
  const c = typeof value === 'string' ? value.toLowerCase() : 'usd';
  return CURRENCIES.has(c) ? c : 'usd';
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function loadSimpleTransferDraft(): SimpleTransferDraft {
  const saved = readJson<Partial<SimpleTransferDraft>>(SIMPLE_KEY);
  return {
    destinationId: normalizeString(saved?.destinationId),
    amount: normalizeString(saved?.amount),
    currency: normalizeCurrency(saved?.currency),
    notes: normalizeString(saved?.notes),
  };
}

export function saveSimpleTransferDraft(draft: SimpleTransferDraft) {
  writeJson(SIMPLE_KEY, {
    destinationId: draft.destinationId,
    amount: draft.amount,
    currency: normalizeCurrency(draft.currency),
    notes: draft.notes,
  });
}

export function loadBulkTransferDraft(): BulkTransferDraft {
  const saved = readJson<Partial<BulkTransferDraft>>(BULK_KEY);
  return {
    destinationId: normalizeString(saved?.destinationId),
    totalAmount: normalizeString(saved?.totalAmount),
    perAmount: normalizeString(saved?.perAmount),
    currency: normalizeCurrency(saved?.currency),
    notes: normalizeString(saved?.notes),
  };
}

export function saveBulkTransferDraft(draft: BulkTransferDraft) {
  writeJson(BULK_KEY, {
    destinationId: draft.destinationId,
    totalAmount: draft.totalAmount,
    perAmount: draft.perAmount,
    currency: normalizeCurrency(draft.currency),
    notes: draft.notes,
  });
}
