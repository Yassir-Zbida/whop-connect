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

function transferMetaMatches(t, paymentId, destinationId, ruleId) {
  const meta = t?.metadata;
  if (!meta || typeof meta !== 'object') return false;
  if (String(meta.payment_id || '').trim() !== String(paymentId).trim()) return false;
  const dest = t?.destination_id ?? t?.destinationId ?? meta.destination_id;
  if (destinationId && String(dest || '').trim() !== String(destinationId).trim()) return false;
  if (ruleId && String(meta.rule_id || '').trim() !== String(ruleId).trim()) return false;
  return true;
}

/** Sum gross amounts already sent for a payment + destination (+ optional rule). */
export async function sumSentGrossForPaymentDestination(
  whop,
  companyId,
  paymentId,
  destinationId,
  ruleId = null
) {
  if (!whop || !companyId || !paymentId || !destinationId) return 0;
  try {
    const page = await whop.transfers.list({
      origin_id: companyId,
      first: TRANSFER_LOOKUP_FIRST,
      order: 'created_at',
      direction: 'desc',
    });
    let total = 0;
    for (const t of paginatedItems(page)) {
      if (!transferMetaMatches(t, paymentId, destinationId, ruleId)) continue;
      const meta = t.metadata;
      const gross = Number(meta?.gross_amount ?? t?.amount ?? 0);
      if (Number.isFinite(gross) && gross > 0) total += gross;
    }
    return Math.round(total * 100) / 100;
  } catch (e) {
    console.warn('[transfer-lookup] Sent gross sum failed:', e?.message);
    return 0;
  }
}
