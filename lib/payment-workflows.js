/**
 * Auto-split and auto-transfer execution (used by background payment worker).
 * One Whop payment fetch per job; auto-split wins when both rules match.
 */

import * as db from '../db.js';
import { getWhop, getWhopCompanyId } from './whop-service.js';
import { paymentBelongsToCompany, pickBestMatchingRule } from './whop-access.js';
import { withUserLock } from './concurrency.js';
import { createAdjustedTransfer, isPermanentTransferError } from './transfer-fees.js';
import { paymentHasExistingTransfer } from './transfer-lookup.js';

const PERMANENT_SKIP_REASONS = new Set([
  'already_processed',
  'disabled_or_no_rules',
  'not_configured',
  'no_matching_rule',
  'payment_not_paid',
  'payment_wrong_company',
  'invalid_amount',
  'workflow_skipped_split_priority',
  'workflow_skipped_transfer_only',
  'workflow_skipped_no_match',
  'already_processed_whop',
]);

const TRANSIENT_REASONS = new Set(['payment_fetch_failed']);

async function logWorkflow(userId, email, action, message, meta = null) {
  try {
    await db.insertActivityLog({ userId, email, action, message, meta });
  } catch (e) {
    console.warn(`[payment-workflows] Activity log failed (${action}):`, e?.message);
  }
}

async function loadPaymentForUser(whop, companyId, paymentId) {
  let payment;
  try {
    payment = await whop.payments.retrieve(paymentId);
  } catch (e) {
    return { payment: null, error: { ran: false, reason: 'payment_fetch_failed', message: e?.message } };
  }
  if (!paymentBelongsToCompany(payment, companyId)) {
    const owner =
      payment?.company_id ??
      payment?.company?.id ??
      payment?.product?.company_id ??
      'unknown';
    console.warn(
      `[payment-workflows] Payment ${paymentId} company mismatch: expected ${companyId}, got ${owner}`
    );
    return {
      payment: null,
      error: { ran: false, reason: 'payment_wrong_company', companyId, paymentCompany: owner },
    };
  }
  if (payment?.status !== 'paid') {
    return {
      payment: null,
      error: { ran: false, reason: 'payment_not_paid', status: payment?.status },
    };
  }
  return { payment, error: null };
}

function paymentContext(payment) {
  const productId = payment?.product?.id ?? null;
  const planId = payment?.plan?.id ?? null;
  const amountRaw = payment?.amount_after_fees ?? payment?.total ?? payment?.usd_total ?? 0;
  const amount = Number(amountRaw);
  const currency = (payment?.currency || 'usd').toLowerCase();
  return { productId, planId, amount, currency };
}

export async function runSplitForPayment(paymentId, userId, ctx = {}) {
  const whop = ctx.whop ?? (await getWhop(userId));
  const companyId = ctx.companyId ?? (await getWhopCompanyId(userId));
  const state = ctx.splitState ?? (await db.getFullAutoSplit(userId));
  if (state.processedPaymentIds.includes(paymentId)) {
    return { ran: false, reason: 'already_processed' };
  }
  if (!whop || !companyId) return { ran: false, reason: 'not_configured' };
  if (!state.enabled || state.rules.length === 0) {
    return { ran: false, reason: 'disabled_or_no_rules' };
  }

  let payment = ctx.payment;
  if (!payment) {
    const loaded = await loadPaymentForUser(whop, companyId, paymentId);
    if (loaded.error) return loaded.error;
    payment = loaded.payment;
  }

  const { productId, planId, amount, currency } = paymentContext(payment);
  if (!amount || amount <= 0) return { ran: false, reason: 'invalid_amount' };

  const rule = ctx.rule ?? pickBestMatchingRule(state.rules, productId, planId);
  if (!rule) {
    return { ran: false, reason: 'no_matching_rule', productId, planId };
  }

  const transfersCreated = [];
  const errors = [];
  for (const split of rule.splits || []) {
    const pct = Number(split.percentage);
    const destId = split.destination_id?.trim();
    if (!destId || !Number.isFinite(pct) || pct <= 0) continue;
    const gross = Math.round((amount * pct) / 100 * 100) / 100;
    try {
      const result = await createAdjustedTransfer(whop, userId, {
        gross,
        currency,
        originId: companyId,
        destinationId: destId,
        metadata: {
          payment_id: paymentId,
          product_id: productId || '',
          rule_id: rule.id || '',
          percentage: pct,
        },
      });
      transfersCreated.push({
        transfer_id: result.transfer.id,
        destination_id: destId,
        amount: result.adjusted,
        gross: result.gross,
        platform_commission: result.platformCommission,
        sendable: result.sendable,
        fee_pct: result.feePct,
        percentage: pct,
      });
    } catch (e) {
      const message = e?.message || String(e);
      errors.push({
        destination_id: destId,
        message,
        permanent: isPermanentTransferError(e),
      });
    }
  }

  if (transfersCreated.length > 0 && errors.length === 0) {
    await db.addProcessedPaymentId(userId, paymentId);
  } else if (
    transfersCreated.length === 0 &&
    errors.length > 0 &&
    errors.every((e) => e.permanent)
  ) {
    await db.addProcessedPaymentId(userId, paymentId);
  }
  return { ran: true, ruleId: rule.id, transfersCreated, errors };
}

export async function runAutoTransferForPayment(paymentId, userId, ctx = {}) {
  const whop = ctx.whop ?? (await getWhop(userId));
  const companyId = ctx.companyId ?? (await getWhopCompanyId(userId));
  const state = ctx.transferState ?? (await db.getFullAutoTransfer(userId));
  if (state.processedPaymentIds.includes(paymentId)) {
    return { ran: false, reason: 'already_processed' };
  }
  if (!whop || !companyId) return { ran: false, reason: 'not_configured' };
  if (!state.enabled || state.rules.length === 0) {
    return { ran: false, reason: 'disabled_or_no_rules' };
  }

  let payment = ctx.payment;
  if (!payment) {
    const loaded = await loadPaymentForUser(whop, companyId, paymentId);
    if (loaded.error) return loaded.error;
    payment = loaded.payment;
  }

  const { productId, planId, amount, currency } = paymentContext(payment);
  if (!amount || amount <= 0) return { ran: false, reason: 'invalid_amount' };

  const rule = ctx.rule ?? pickBestMatchingRule(state.rules, productId, planId);
  if (!rule) {
    return { ran: false, reason: 'no_matching_rule', productId, planId };
  }

  const transfersCreated = [];
  const errors = [];
  const destId = rule.destination_id?.trim();
  if (destId) {
    let gross;
    if (rule.transfer_type === 'fixed') {
      gross = Math.min(Number(rule.value) || 0, amount);
    } else {
      gross = Math.round((amount * (Number(rule.value) || 0)) / 100 * 100) / 100;
    }
    if (!Number.isFinite(gross) || gross <= 0) {
      errors.push({
        destination_id: destId,
        rule_id: rule.id,
        message: `Invalid transfer gross amount ${gross}`,
        permanent: true,
      });
    } else {
      try {
        const result = await createAdjustedTransfer(whop, userId, {
          gross,
          currency,
          originId: companyId,
          destinationId: destId,
          metadata: {
            payment_id: paymentId,
            product_id: productId || '',
            rule_id: rule.id || '',
            transfer_type: rule.transfer_type,
            value: rule.value,
          },
        });
        transfersCreated.push({
          transfer_id: result.transfer.id,
          destination_id: destId,
          amount: result.adjusted,
          gross: result.gross,
          platform_commission: result.platformCommission,
          sendable: result.sendable,
          fee_pct: result.feePct,
          rule_id: rule.id,
        });
      } catch (e) {
        const errMsg = e?.message || String(e);
        errors.push({
          destination_id: destId,
          rule_id: rule.id,
          message: errMsg,
          permanent: isPermanentTransferError(e),
        });
        console.error(`[auto-transfer] Failed payment=${paymentId} dest=${destId}: ${errMsg}`);
      }
    }
  }

  if (transfersCreated.length > 0 && errors.length === 0) {
    await db.addProcessedPaymentIdAutoTransfer(userId, paymentId);
  } else if (
    transfersCreated.length === 0 &&
    errors.length > 0 &&
    errors.every((e) => e.permanent)
  ) {
    await db.addProcessedPaymentIdAutoTransfer(userId, paymentId);
  }
  return { ran: true, ruleId: rule.id, transfersCreated, errors };
}

/**
 * Decide if queue job should complete or be requeued for retry.
 */
export function evaluatePaymentJobOutcome(result) {
  const parts = [result?.split, result?.autoTransfer].filter(Boolean);
  const transferErrors = parts.flatMap((p) => p.errors || []);

  const permanentErrors = transferErrors.filter((e) => e.permanent);
  const transientErrors = transferErrors.filter((e) => !e.permanent);

  if (transientErrors.length > 0) {
    return {
      shouldComplete: false,
      shouldRequeue: true,
      lastError: transientErrors.map((e) => e.message || String(e)).join('; ').slice(0, 2000),
    };
  }

  if (permanentErrors.length > 0 && transientErrors.length === 0) {
    return {
      shouldComplete: true,
      shouldRequeue: false,
      lastError: permanentErrors.map((e) => e.message || String(e)).join('; ').slice(0, 2000),
    };
  }

  for (const p of parts) {
    if (TRANSIENT_REASONS.has(p.reason)) {
      return {
        shouldComplete: false,
        shouldRequeue: true,
        lastError: p.message || p.reason,
      };
    }
  }

  const anySuccess = parts.some((p) => (p.transfersCreated?.length ?? 0) > 0);
  if (anySuccess) {
    return { shouldComplete: true, shouldRequeue: false };
  }

  const allPermanent = parts.every((p) => !p.reason || PERMANENT_SKIP_REASONS.has(p.reason));
  if (allPermanent && parts.length > 0) {
    return { shouldComplete: true, shouldRequeue: false };
  }

  const matchedNoTransfer = parts.some(
    (p) => p.ran && p.ruleId && (p.transfersCreated?.length ?? 0) === 0
  );
  if (matchedNoTransfer) {
    return {
      shouldComplete: false,
      shouldRequeue: true,
      lastError: 'Rule matched but no transfers were created',
    };
  }

  return { shouldComplete: true, shouldRequeue: false };
}

/**
 * Process one payment: single Whop fetch; auto-split wins when both could apply.
 */
export async function processPaymentWorkflows(userId, paymentId) {
  return withUserLock(userId, async () => {
    const u = await db.getUserById(userId);
    const email = u?.email ?? null;

    const [whop, companyId, splitState, transferState] = await Promise.all([
      getWhop(userId),
      getWhopCompanyId(userId),
      db.getFullAutoSplit(userId),
      db.getFullAutoTransfer(userId),
    ]);

    let splitResult = { ran: false, reason: 'not_configured', transfersCreated: [], errors: [] };
    let autoTransferResult = {
      ran: false,
      reason: 'not_configured',
      transfersCreated: [],
      errors: [],
    };

    if (!whop || !companyId) {
      splitResult.reason = 'not_configured';
      autoTransferResult.reason = 'not_configured';
    } else {
      const loaded = await loadPaymentForUser(whop, companyId, paymentId);
      if (loaded.error) {
        splitResult = { ...loaded.error, transfersCreated: [], errors: [] };
        autoTransferResult = {
          ...loaded.error,
          transfersCreated: [],
          errors: [],
        };
      } else {
        const { payment } = loaded;

        const alreadyOnWhop = await paymentHasExistingTransfer(whop, companyId, paymentId);
        if (alreadyOnWhop) {
          if (
            splitState.enabled &&
            !splitState.processedPaymentIds.includes(paymentId)
          ) {
            await db.addProcessedPaymentId(userId, paymentId);
          }
          if (
            transferState.enabled &&
            !transferState.processedPaymentIds.includes(paymentId)
          ) {
            await db.addProcessedPaymentIdAutoTransfer(userId, paymentId);
          }
          splitResult = {
            ran: false,
            reason: 'already_processed_whop',
            transfersCreated: [],
            errors: [],
          };
          autoTransferResult = {
            ran: false,
            reason: 'already_processed_whop',
            transfersCreated: [],
            errors: [],
          };
        } else {
        const { productId, planId } = paymentContext(payment);
        const splitRule =
          splitState.enabled && !splitState.processedPaymentIds.includes(paymentId)
            ? pickBestMatchingRule(splitState.rules, productId, planId)
            : null;
        const transferRule =
          transferState.enabled && !transferState.processedPaymentIds.includes(paymentId)
            ? pickBestMatchingRule(transferState.rules, productId, planId)
            : null;

        const baseCtx = { whop, companyId, payment };

        if (splitRule) {
          splitResult = await runSplitForPayment(paymentId, userId, {
            ...baseCtx,
            splitState,
            rule: splitRule,
          });
          autoTransferResult = {
            ran: false,
            reason: 'workflow_skipped_split_priority',
            transfersCreated: [],
            errors: [],
          };
        } else if (transferRule) {
          splitResult = {
            ran: false,
            reason: 'workflow_skipped_transfer_only',
            transfersCreated: [],
            errors: [],
          };
          autoTransferResult = await runAutoTransferForPayment(paymentId, userId, {
            ...baseCtx,
            transferState,
            rule: transferRule,
          });
        } else {
          const reason = splitState.processedPaymentIds.includes(paymentId)
            ? 'already_processed'
            : transferState.processedPaymentIds.includes(paymentId)
              ? 'already_processed'
              : 'no_matching_rule';
          splitResult = { ran: false, reason, transfersCreated: [], errors: [] };
          autoTransferResult = {
            ran: false,
            reason: 'workflow_skipped_no_match',
            transfersCreated: [],
            errors: [],
          };
        }
        }
      }
    }

    await logWorkflow(
      userId,
      email,
      'webhook_split',
      splitResult.ran
        ? `Split ran for payment ${paymentId}`
        : `Split skipped: ${splitResult.reason || 'unknown'}`,
      {
        payment_id: paymentId,
        ran: splitResult.ran,
        reason: splitResult.reason,
        transfers: splitResult.transfersCreated?.length ?? 0,
        errors: splitResult.errors?.length ?? 0,
      }
    );

    await logWorkflow(
      userId,
      email,
      'webhook_auto_transfer',
      autoTransferResult.ran
        ? `Auto-transfer ${autoTransferResult.transfersCreated?.length ? 'ran' : 'skipped'} for payment ${paymentId}`
        : `Auto-transfer skipped: ${autoTransferResult.reason || 'unknown'}`,
      {
        payment_id: paymentId,
        ran: autoTransferResult.ran,
        reason: autoTransferResult.reason,
        transfers: autoTransferResult.transfersCreated?.length ?? 0,
        errors: autoTransferResult.errors?.length ?? 0,
        error_details: autoTransferResult.errors ?? [],
      }
    );

    return { split: splitResult, autoTransfer: autoTransferResult };
  });
}
