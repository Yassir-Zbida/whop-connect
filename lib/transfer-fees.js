/**
 * Two-step transfer fee pipeline:
 * 1. Platform commission (configurable per user)
 * 2. Whop transfer fee adjustment (auto-learned, default 3%)
 */

import * as db from '../db.js';
import { APP_INITIATED_BY } from './transfer-lookup.js';

export const DEFAULT_FEE_PCT = 0.03;
export const MIN_TRANSFER_USD = Number(process.env.WHOP_MIN_TRANSFER_AMOUNT) || 1;

export function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

/** Split total gross into per-transfer chunks (last chunk may be smaller). */
export function buildBulkTransferAmounts(totalAmount, perTransferAmount) {
  const total = round2(totalAmount);
  const per = round2(perTransferAmount);
  const amounts = [];
  let remaining = total;
  while (remaining >= per - 1e-9) {
    amounts.push(per);
    remaining = round2(remaining - per);
  }
  if (remaining > 0.001) {
    amounts.push(remaining);
  }
  return amounts;
}

function roundDown(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.floor(Number(value) * factor + 1e-9) / factor;
}

export function calculateCommission(gross, commissionPct) {
  const g = Number(gross);
  const pct = Number(commissionPct);
  const commission = round2(g * (pct / 100));
  return {
    platformCommission: commission,
    sendable: round2(g - commission),
  };
}

export function adjustForWhopFee(sendable, feePct) {
  return roundDown(Number(sendable) / (1 + Number(feePct)), 2);
}

export function computeTransferAmounts(gross, commissionPct, feePct) {
  const { platformCommission, sendable } = calculateCommission(gross, commissionPct);
  const adjusted = adjustForWhopFee(sendable, feePct);
  if (!Number.isFinite(adjusted) || adjusted < MIN_TRANSFER_USD) {
    const err = new Error(
      `Amount $${Number(adjusted || 0).toFixed(2)} below Whop minimum $${MIN_TRANSFER_USD.toFixed(2)} ` +
        `(gross $${Number(gross).toFixed(2)} after commission and fee adjustment)`
    );
    err.code = 'below_minimum';
    err.permanent = true;
    throw err;
  }
  return { platformCommission, sendable, adjusted, feePct: Number(feePct) };
}

export async function getFeePct(userId) {
  const settings = await db.getUserSettings(userId);
  const cached = settings?.cached_fee_pct;
  if (cached != null && Number.isFinite(Number(cached)) && Number(cached) >= 0) {
    return Number(cached);
  }
  return DEFAULT_FEE_PCT;
}

export async function updateCachedFeePctFromTransfer(userId, transferAmount, feeAmount) {
  const amount = Number(transferAmount);
  const fee = Number(feeAmount);
  if (!amount || amount <= 0 || !Number.isFinite(fee) || fee < 0) return;
  const feePct = fee / amount;
  if (!Number.isFinite(feePct) || feePct < 0) return;
  await db.updateCachedFeePct(userId, feePct);
}

function isBalanceError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('balance') ||
    msg.includes('insufficient') ||
    msg.includes('negative') ||
    msg.includes('not enough')
  );
}

function learnFeePctFromDeficit(sendable, adjusted) {
  if (!adjusted || adjusted <= 0 || !sendable || sendable <= adjusted) return null;
  const learned = sendable / adjusted - 1;
  if (!Number.isFinite(learned) || learned <= 0 || learned >= 1) return null;
  return round2(learned + 0.005);
}

/**
 * Create a Whop transfer with commission + fee-adjusted amount.
 * Retries once on balance errors with a recalculated fee percentage.
 */
export async function createAdjustedTransfer(whop, userId, opts) {
  const {
    gross,
    currency,
    originId,
    destinationId,
    metadata = {},
    notes,
    commissionPct: commissionPctOverride,
    feePct: feePctOverride,
  } = opts;

  const settings = await db.getUserSettings(userId);
  const commissionPct =
    commissionPctOverride != null
      ? Number(commissionPctOverride)
      : Number(settings?.platform_commission_pct ?? 1);

  let feePct = feePctOverride != null ? Number(feePctOverride) : await getFeePct(userId);

  let amounts;
  try {
    amounts = computeTransferAmounts(gross, commissionPct, feePct);
  } catch (e) {
    throw e;
  }

  const buildPayload = (a, pct) => ({
    amount: a.adjusted,
    currency: (currency || 'usd').toLowerCase(),
    origin_id: originId,
    destination_id: destinationId,
    metadata: {
      ...metadata,
      initiated_by: APP_INITIATED_BY,
      gross_amount: round2(gross),
      platform_commission: a.platformCommission,
      sendable_amount: a.sendable,
      fee_pct: pct,
    },
    ...(typeof notes === 'string' && notes.trim() ? { notes: notes.trim().slice(0, 50) } : {}),
  });

  const attemptTransfer = async (pct) => {
    const a = computeTransferAmounts(gross, commissionPct, pct);
    const transfer = await whop.transfers.create(buildPayload(a, pct));
    return { transfer, amounts: a, feePct: pct };
  };

  try {
    const { transfer, amounts: finalAmounts, feePct: usedFeePct } = await attemptTransfer(feePct);
    if (transfer?.fee_amount != null && transfer?.amount) {
      await updateCachedFeePctFromTransfer(userId, transfer.amount, transfer.fee_amount);
    }
    return {
      transfer,
      gross: round2(gross),
      platformCommission: finalAmounts.platformCommission,
      sendable: finalAmounts.sendable,
      adjusted: finalAmounts.adjusted,
      feePct: usedFeePct,
    };
  } catch (err) {
    if (!isBalanceError(err)) throw err;

    const learnedPct = learnFeePctFromDeficit(amounts.sendable, amounts.adjusted);
    const retryFeePct =
      learnedPct != null && learnedPct > feePct ? learnedPct : round2(feePct + 0.01);

    if (retryFeePct <= feePct || retryFeePct >= 1) throw err;

    try {
      const { transfer, amounts: finalAmounts, feePct: usedFeePct } = await attemptTransfer(retryFeePct);
      await db.updateCachedFeePct(userId, usedFeePct);
      if (transfer?.fee_amount != null && transfer?.amount) {
        await updateCachedFeePctFromTransfer(userId, transfer.amount, transfer.fee_amount);
      }
      return {
        transfer,
        gross: round2(gross),
        platformCommission: finalAmounts.platformCommission,
        sendable: finalAmounts.sendable,
        adjusted: finalAmounts.adjusted,
        feePct: usedFeePct,
      };
    } catch (retryErr) {
      throw retryErr;
    }
  }
}

export function isPermanentTransferError(err) {
  if (err?.permanent || err?.code === 'below_minimum') return true;
  const msg = String(err?.message || err || '');
  return msg.includes('below Whop minimum');
}
