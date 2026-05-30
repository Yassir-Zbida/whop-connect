/**
 * Whop transfer metadata lookup for duplicate payment detection.
 */

import * as db from '../db.js';

export const APP_INITIATED_BY = 'whop-admin';
const TRANSFER_LOOKUP_FIRST = Number(process.env.PAYMENT_POLL_TRANSFER_LOOKUP) || 200;

function paginatedItems(page) {
  if (!page) return [];
  if (typeof page.getPaginatedItems === 'function') return page.getPaginatedItems();
  if (Array.isArray(page.data)) return page.data;
  return [];
}

/** Payment IDs already transferred from this company (Whop transfer metadata). */
export async function fetchTransferPaymentIds(whop, companyId) {
  if (!whop || !companyId) return new Set();
  try {
    const page = await whop.transfers.list({
      origin_id: companyId,
      first: TRANSFER_LOOKUP_FIRST,
      order: 'created_at',
      direction: 'desc',
    });
    const ids = new Set();
    for (const t of paginatedItems(page)) {
      const meta = t?.metadata;
      if (!meta || typeof meta !== 'object') continue;
      const pid = meta.payment_id;
      if (typeof pid === 'string' && pid.trim()) {
        ids.add(pid.trim());
      }
    }
    return ids;
  } catch (e) {
    console.warn('[transfer-lookup] Transfer lookup failed:', e?.message);
    return new Set();
  }
}

/** Local processed lists + Whop transfer history. */
export async function getEffectiveProcessedIds(userId, whop, companyId) {
  const [splitState, transferState, transferIds] = await Promise.all([
    db.getFullAutoSplit(userId),
    db.getFullAutoTransfer(userId),
    fetchTransferPaymentIds(whop, companyId),
  ]);
  return new Set([
    ...(splitState.processedPaymentIds || []),
    ...(transferState.processedPaymentIds || []),
    ...transferIds,
  ]);
}

export async function paymentHasExistingTransfer(whop, companyId, paymentId) {
  const ids = await fetchTransferPaymentIds(whop, companyId);
  return ids.has(paymentId);
}
