/** Mirror of server-side transfer fee math for UI previews. */

export const DEFAULT_FEE_PCT = 0.03;
export const MIN_TRANSFER_USD = 1;

function round2(value: number) {
  return Math.round(Number(value) * 100) / 100;
}

function roundDown(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.floor(Number(value) * factor + 1e-9) / factor;
}

export function computeTransferAmounts(gross: number, commissionPct: number, feePct: number) {
  const commission = round2(gross * (commissionPct / 100));
  const sendable = round2(gross - commission);
  const adjusted = roundDown(sendable / (1 + feePct), 2);
  return { platformCommission: commission, sendable, adjusted, feePct };
}

/** Split total gross into per-transfer chunks (last chunk may be smaller). */
export function buildBulkTransferAmounts(totalAmount: number, perTransferAmount: number): number[] {
  const total = round2(totalAmount);
  const per = round2(perTransferAmount);
  const amounts: number[] = [];
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

function calculateCommission(gross: number, commissionPct: number) {
  const commission = round2(gross * (commissionPct / 100));
  return { platformCommission: commission, sendable: round2(gross - commission) };
}

/** Conservative ledger debit for a gross transfer (fees + rounding headroom). */
export function estimateDebitFromGross(gross: number, commissionPct: number, feePct: number): number {
  const g = round2(Number(gross));
  if (!(g > 0)) return 0;
  const { sendable } = calculateCommission(g, commissionPct);
  const bufferedFeePct = Number(feePct) + 0.005;
  const headroom = round2(Math.max(0.03, sendable * bufferedFeePct));
  return round2(sendable + headroom);
}

/** Largest gross amount whose estimated debit fits within a ledger budget. */
export function maxGrossForDebitBudget(budget: number, commissionPct: number, feePct: number): number {
  const budgetLeft = round2(Number(budget));
  if (!(budgetLeft > 0)) return 0;

  const commissionFactor = Math.max(0.01, 1 - Number(commissionPct) / 100);
  let lo = 0;
  let hi = round2(budgetLeft / commissionFactor);

  for (let i = 0; i < 50; i++) {
    const mid = round2((lo + hi) / 2);
    if (estimateDebitFromGross(mid, commissionPct, feePct) <= budgetLeft + 1e-9) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (Math.abs(hi - lo) < 0.001) break;
  }

  return roundDown(lo, 2);
}

/**
 * Split a total ledger budget into gross chunks that account for commission + Whop fees.
 * The last transfer is sized to the remaining budget so the batch does not overdraw.
 */
export function buildFeeAwareBulkTransferAmounts(
  totalBudget: number,
  perTransferGross: number,
  commissionPct: number,
  feePct: number
): number[] {
  const budget = round2(totalBudget);
  const per = round2(perTransferGross);
  if (!(budget > 0) || !(per > 0)) return [];

  const amounts: number[] = [];
  let remaining = budget;
  const perDebit = estimateDebitFromGross(per, commissionPct, feePct);

  while (remaining > 0.001) {
    if (remaining + 1e-9 >= perDebit) {
      amounts.push(per);
      remaining = round2(remaining - perDebit);
      continue;
    }

    const lastGross = maxGrossForDebitBudget(remaining, commissionPct, feePct);
    if (lastGross > 0.001) {
      try {
        computeTransferAmounts(lastGross, commissionPct, feePct);
        amounts.push(lastGross);
      } catch {
        /* remainder below Whop minimum after fees */
      }
    }
    break;
  }

  return amounts;
}

export function getEffectiveFeePct(cachedFeePct: number | null | undefined): number {
  if (cachedFeePct != null && Number.isFinite(Number(cachedFeePct)) && Number(cachedFeePct) >= 0) {
    return Number(cachedFeePct);
  }
  return DEFAULT_FEE_PCT;
}
