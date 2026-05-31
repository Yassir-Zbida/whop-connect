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

export function getEffectiveFeePct(cachedFeePct: number | null | undefined): number {
  if (cachedFeePct != null && Number.isFinite(Number(cachedFeePct)) && Number(cachedFeePct) >= 0) {
    return Number(cachedFeePct);
  }
  return DEFAULT_FEE_PCT;
}
