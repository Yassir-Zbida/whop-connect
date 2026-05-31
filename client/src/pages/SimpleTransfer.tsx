import { useState, useEffect, useMemo } from 'react';
import { Icon, IconPaths } from '../components/Icon';
import { getSettings, createTransfer, getTransfers, getBalance, getBalances, type Transfer, type LedgerBalance } from '../api';
import { useToast } from '../context/ToastContext';
import { logSuccess, logError } from '../utils/logger';
import {
  buildFeeAwareBulkTransferAmounts,
  computeTransferAmounts,
  estimateDebitFromGross,
  getEffectiveFeePct,
  maxGrossForDebitBudget,
  MIN_TRANSFER_USD,
} from '../utils/transfer-fees';
import {
  loadBulkTransferDraft,
  loadSimpleTransferDraft,
  saveBulkTransferDraft,
  saveSimpleTransferDraft,
} from '../lib/transferFormDraft';

const initialSimple = loadSimpleTransferDraft();
const initialBulk = loadBulkTransferDraft();

const CURRENCY_OPTIONS = [
  { value: 'usd', label: 'USD — US Dollar' },
  { value: 'eur', label: 'EUR — Euro' },
  { value: 'gbp', label: 'GBP — British Pound' },
  { value: 'sgd', label: 'SGD — Singapore Dollar' },
];

function currencyLabel(code: string) {
  return CURRENCY_OPTIONS.find((c) => c.value === code)?.label ?? code.toUpperCase();
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  }).format(amount);
}

function round2(value: number) {
  return Math.round(Number(value) * 100) / 100;
}

function BalanceStatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="card analytics-stat-card" style={{ padding: 18, textAlign: 'center' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function BalanceFillButton({
  currency,
  disabled,
  onFill,
}: {
  currency: string;
  disabled?: boolean;
  onFill: (amount: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const handleClick = () => {
    setLoading(true);
    getBalance(currency)
      .then((res) => {
        if (res.transferable <= 0) {
          showToast(`No available ${currency.toUpperCase()} balance to transfer`, 'error');
          return;
        }
        onFill(res.transferable.toFixed(2));
        showToast(`Filled ${formatCurrency(res.transferable, currency)} available balance`);
      })
      .catch((err) => {
        const text = err instanceof Error ? err.message : 'Could not fetch balance';
        showToast(text, 'error');
      })
      .finally(() => setLoading(false));
  };

  return (
    <button
      type="button"
      className="amount-fill-btn"
      onClick={handleClick}
      disabled={disabled || loading}
      title="Use full available balance"
      aria-label="Use full available balance"
    >
      <Icon d={IconPaths.dollar} size={14} />
    </button>
  );
}

export default function SimpleTransfer() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [platformCommissionPct, setPlatformCommissionPct] = useState(1);
  const [cachedFeePct, setCachedFeePct] = useState<number | null>(null);
  const [destinationId, setDestinationId] = useState(initialSimple.destinationId);
  const [amount, setAmount] = useState(initialSimple.amount);
  const [currency, setCurrency] = useState(initialSimple.currency);
  const [notes, setNotes] = useState(initialSimple.notes);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [bulkDestinationId, setBulkDestinationId] = useState(initialBulk.destinationId);
  const [bulkTotalAmount, setBulkTotalAmount] = useState(initialBulk.totalAmount);
  const [bulkPerAmount, setBulkPerAmount] = useState(initialBulk.perAmount);
  const [bulkCurrency, setBulkCurrency] = useState(initialBulk.currency);
  const [bulkNotes, setBulkNotes] = useState(initialBulk.notes);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);
  const [bulkMsg, setBulkMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loadingTransfers, setLoadingTransfers] = useState(true);
  const [ledgerBalances, setLedgerBalances] = useState<LedgerBalance[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [overviewCurrency, setOverviewCurrency] = useState(initialSimple.currency || 'usd');
  const { showToast } = useToast();

  const feePct = getEffectiveFeePct(cachedFeePct);

  const loadSettings = () => {
    getSettings()
      .then((s) => {
        setCompanyId(s.whopCompanyId ?? null);
        setPlatformCommissionPct(s.platformCommissionPct ?? 1);
        setCachedFeePct(s.cachedFeePct ?? null);
      })
      .catch(() => {
        setCompanyId(null);
        setPlatformCommissionPct(1);
        setCachedFeePct(null);
      });
  };

  const loadTransfers = () => {
    setLoadingTransfers(true);
    getTransfers()
      .then((res) => setTransfers(res.data || []))
      .catch(() => setTransfers([]))
      .finally(() => setLoadingTransfers(false));
  };

  const loadBalances = () => {
    if (!companyId) {
      setLedgerBalances([]);
      setBalanceError(null);
      return;
    }
    setLoadingBalances(true);
    setBalanceError(null);
    getBalances()
      .then((res) => {
        const rows = res.balances || [];
        setLedgerBalances(rows);
        if (rows.length > 0 && !rows.some((b) => b.currency === overviewCurrency)) {
          setOverviewCurrency(rows[0].currency);
        }
      })
      .catch((err) => {
        setLedgerBalances([]);
        setBalanceError(err instanceof Error ? err.message : 'Could not load balance');
      })
      .finally(() => setLoadingBalances(false));
  };

  const refreshPageData = () => {
    loadTransfers();
    loadBalances();
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    loadTransfers();
  }, []);

  useEffect(() => {
    loadBalances();
  }, [companyId]);

  const overviewBalanceOptions = useMemo(() => {
    const fromApi = ledgerBalances.map((b) => b.currency);
    const merged = new Set([...fromApi, ...CURRENCY_OPTIONS.map((c) => c.value)]);
    return Array.from(merged).sort();
  }, [ledgerBalances]);

  const selectedOverviewBalance = useMemo(() => {
    const found = ledgerBalances.find((b) => b.currency === overviewCurrency);
    return (
      found ?? {
        currency: overviewCurrency,
        balance: 0,
        pending_balance: 0,
        reserve_balance: 0,
        transferable: 0,
      }
    );
  }, [ledgerBalances, overviewCurrency]);

  useEffect(() => {
    saveSimpleTransferDraft({ destinationId, amount, currency, notes });
  }, [destinationId, amount, currency, notes]);

  useEffect(() => {
    saveBulkTransferDraft({
      destinationId: bulkDestinationId,
      totalAmount: bulkTotalAmount,
      perAmount: bulkPerAmount,
      currency: bulkCurrency,
      notes: bulkNotes,
    });
  }, [bulkDestinationId, bulkTotalAmount, bulkPerAmount, bulkCurrency, bulkNotes]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const destId = destinationId.trim();
    const num = parseFloat(amount);
    if (!destId) {
      setMsg({ text: 'Enter destination (user_xxx, biz_xxx, or ldgr_xxx)', error: true });
      return;
    }
    if (!Number.isFinite(num) || num <= 0) {
      setMsg({ text: 'Enter a valid positive amount', error: true });
      return;
    }
    setMsg(null);
    setSubmitting(true);
    createTransfer({
      destination_id: destId,
      amount: num,
      currency: currency || 'usd',
      ...(notes.trim() ? { notes: notes.trim().slice(0, 50) } : {}),
    })
      .then((res) => {
        const parts = [`Transfer created. ID: ${res.id}`];
        if (res.adjusted != null && res.gross != null && res.adjusted !== res.gross) {
          parts.push(
            `Sent $${res.adjusted.toFixed(2)} (from $${res.gross.toFixed(2)} after commission and Whop fees).`
          );
        }
        const text = parts.join(' ');
        setMsg({ text, error: false });
        logSuccess('Simple transfer', text, {
          transferId: res.id,
          amount: num,
          adjusted: res.adjusted,
          destination_id: destId,
        });
        showToast(text);
        loadTransfers();
        loadBalances();
      })
      .catch((err) => {
        const text = err instanceof Error ? err.message : 'Transfer failed';
        setMsg({ text, error: true });
        logError('Simple transfer', text);
        showToast(text, 'error');
      })
      .finally(() => setSubmitting(false));
  };

  const bulkPreview = useMemo(() => {
    const total = parseFloat(bulkTotalAmount);
    const per = parseFloat(bulkPerAmount);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(per) || per <= 0 || per > total) {
      return null;
    }
    const grossChunks = buildFeeAwareBulkTransferAmounts(total, per, platformCommissionPct, feePct);
    if (!grossChunks.length) return null;

    const perAmount = round2(per);
    const transfers = grossChunks.map((gross) =>
      computeTransferAmounts(gross, platformCommissionPct, feePct)
    );
    const belowMinimum = transfers.find((t) => t.adjusted < MIN_TRANSFER_USD);
    const totalGross = grossChunks.reduce((sum, g) => sum + g, 0);
    const totalAdjusted = transfers.reduce((sum, t) => sum + t.adjusted, 0);
    const totalCommission = transfers.reduce((sum, t) => sum + t.platformCommission, 0);
    const totalEstimatedDebit = grossChunks.reduce(
      (sum, g) => sum + estimateDebitFromGross(g, platformCommissionPct, feePct),
      0
    );
    const lastChunkFeeAdjusted =
      grossChunks.length > 0 && grossChunks[grossChunks.length - 1] < perAmount - 1e-9;

    return {
      count: grossChunks.length,
      grossChunks,
      transfers,
      totalGross,
      totalAdjusted,
      totalCommission,
      totalEstimatedDebit,
      belowMinimum,
      lastChunkFeeAdjusted,
      perAmount,
    };
  }, [bulkTotalAmount, bulkPerAmount, platformCommissionPct, feePct]);

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const destId = bulkDestinationId.trim();
    const total = parseFloat(bulkTotalAmount);
    const per = parseFloat(bulkPerAmount);

    if (!destId) {
      setBulkMsg({ text: 'Enter destination (user_xxx, biz_xxx, or ldgr_xxx)', error: true });
      return;
    }
    if (!Number.isFinite(total) || total <= 0) {
      setBulkMsg({ text: 'Enter a valid total amount', error: true });
      return;
    }
    if (!Number.isFinite(per) || per <= 0) {
      setBulkMsg({ text: 'Enter a valid per-transfer amount', error: true });
      return;
    }
    if (per > total) {
      setBulkMsg({ text: 'Per-transfer amount cannot exceed total amount', error: true });
      return;
    }
    if (!bulkPreview) {
      setBulkMsg({ text: 'Could not build transfer plan', error: true });
      return;
    }
    if (bulkPreview.belowMinimum) {
      setBulkMsg({
        text: `Each transfer must send at least $${MIN_TRANSFER_USD.toFixed(2)} after fees. Increase per-transfer amount or total.`,
        error: true,
      });
      return;
    }

    setBulkMsg(null);
    setBulkSubmitting(true);
    setBulkProgress({ current: 0, total: bulkPreview.count });

    const succeeded: Array<{ id: string; gross: number; adjusted: number }> = [];
    let failedAt: number | null = null;
    let failMessage = '';
    let debitRemaining = total;

    for (let i = 0; i < bulkPreview.grossChunks.length; i++) {
      let gross = bulkPreview.grossChunks[i];
      const isLast = i === bulkPreview.grossChunks.length - 1;
      if (isLast) {
        const capped = maxGrossForDebitBudget(debitRemaining, platformCommissionPct, feePct);
        if (capped > 0) gross = Math.min(gross, capped);
      }
      if (!(gross > 0)) continue;

      setBulkProgress({ current: i + 1, total: bulkPreview.count });
      try {
        const batchNote = bulkNotes.trim()
          ? `${bulkNotes.trim().slice(0, 40)} (${i + 1}/${bulkPreview.count})`
          : `Batch ${i + 1}/${bulkPreview.count}`;
        const res = await createTransfer({
          destination_id: destId,
          amount: gross,
          currency: bulkCurrency || 'usd',
          notes: batchNote.slice(0, 50),
          metadata: { batch_transfer: true, batch_index: i + 1, batch_total: bulkPreview.count },
        });
        const actualDebit =
          res.sendable != null
            ? round2(Number(res.sendable))
            : estimateDebitFromGross(res.gross ?? gross, platformCommissionPct, feePct);
        debitRemaining = round2(Math.max(0, debitRemaining - actualDebit));
        succeeded.push({
          id: res.id,
          gross: res.gross ?? gross,
          adjusted: res.adjusted ?? gross,
        });
      } catch (err) {
        failedAt = i + 1;
        failMessage = err instanceof Error ? err.message : 'Transfer failed';
        break;
      }
    }

    setBulkSubmitting(false);
    setBulkProgress(null);

    if (failedAt != null) {
      const partial =
        succeeded.length > 0
          ? ` Completed ${succeeded.length} of ${bulkPreview.count} before failure.`
          : '';
      const text = `Batch stopped at transfer ${failedAt}: ${failMessage}.${partial}`;
      setBulkMsg({ text, error: true });
      logError('Bulk transfer', text);
      showToast(text, 'error');
    } else {
      const totalSent = succeeded.reduce((sum, t) => sum + t.adjusted, 0);
      const text =
        `Batch complete: ${succeeded.length} transfers sent (~${formatCurrency(totalSent, bulkCurrency)} received after fees, ` +
        `${formatCurrency(bulkPreview.totalGross, bulkCurrency)} gross).`;
      setBulkMsg({ text, error: false });
      logSuccess('Bulk transfer', text, {
        count: succeeded.length,
        totalGross: bulkPreview.totalGross,
        totalAdjusted: totalSent,
        destination_id: destId,
      });
      showToast(text);
    }

    loadTransfers();
    loadBalances();
  };

  return (
    <main className="main">
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="topbar-title">Transfer funds</span>
          <span className="topbar-sub">· Any account (user, company, or ledger)</span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={refreshPageData}
          disabled={loadingTransfers || loadingBalances}
          style={{ gap: 6 }}
        >
          <Icon d={IconPaths.refresh} size={12} />
          {loadingTransfers || loadingBalances ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <div className="content">
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.dollar} size={14} />
              <span className="card-title">Account balance</span>
            </div>
            <select
              className="select-native"
              value={overviewCurrency}
              onChange={(e) => setOverviewCurrency(e.target.value)}
              disabled={!companyId || loadingBalances}
              aria-label="Balance currency"
            >
              {overviewBalanceOptions.map((code) => (
                <option key={code} value={code}>
                  {currencyLabel(code)}
                </option>
              ))}
            </select>
          </div>
          <div className="card-body" style={{ paddingTop: 16 }}>
            {!companyId ? (
              <div className="alert alert-error">
                Set your Whop API key and Company ID in Settings to view your ledger balance.
              </div>
            ) : balanceError ? (
              <div className="alert alert-error">{balanceError}</div>
            ) : loadingBalances && ledgerBalances.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 0' }}>
                <p>Loading balance…</p>
              </div>
            ) : (
              <div className="balance-stat-grid">
                <BalanceStatCard
                  label="Available balance"
                  value={formatCurrency(selectedOverviewBalance.balance, overviewCurrency)}
                  color="var(--green)"
                />
                <BalanceStatCard
                  label="Pending amount"
                  value={formatCurrency(selectedOverviewBalance.pending_balance, overviewCurrency)}
                  color="rgba(234, 179, 8, 0.95)"
                />
                <BalanceStatCard
                  label="Held / reserved"
                  value={formatCurrency(selectedOverviewBalance.reserve_balance, overviewCurrency)}
                  color="var(--text)"
                />
                <BalanceStatCard
                  label="Transferable"
                  value={formatCurrency(selectedOverviewBalance.transferable, overviewCurrency)}
                  sub="Available minus reserve"
                  color="var(--accent)"
                />
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.transfer} size={14} />
              <span className="card-title">Simple transfer</span>
            </div>
          </div>
          <div className="card-body">
            <p className="card-desc">
              Send funds from your company to any Whop account: user (<code>user_xxx</code>), company (
              <code>biz_xxx</code>), or ledger account (<code>ldgr_xxx</code>). No need for a connected account.
              Amount is debited from your balance; platform commission and Whop transfer fees are deducted automatically.
            </p>
            {!companyId ? (
              <div className="alert alert-error" style={{ marginTop: 12 }}>
                Set your Whop API key and Company ID in Settings first. Your company is the origin of the transfer.
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
                <div className="field">
                  <label className="field-label">From (your company)</label>
                  <input
                    type="text"
                    className="field-input monospace"
                    value={companyId}
                    readOnly
                    aria-readonly
                  />
                </div>
                <div className="field">
                  <label className="field-label">Destination ID *</label>
                  <input
                    id="st-destination"
                    type="text"
                    className="field-input monospace"
                    placeholder="user_xxx, biz_xxx, or ldgr_xxx"
                    value={destinationId}
                    onChange={(e) => setDestinationId(e.target.value)}
                    autoComplete="off"
                    disabled={submitting}
                  />
                </div>
                <div className="form-grid-3">
                  <div className="field">
                    <label className="field-label">Amount *</label>
                    <div className="amount-input-wrap">
                      <input
                        id="st-amount"
                        type="number"
                        className="field-input"
                        placeholder="0.00"
                        min="0.01"
                        step="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        disabled={submitting}
                      />
                      <BalanceFillButton currency={currency} disabled={submitting} onFill={setAmount} />
                    </div>
                  </div>
                  <div className="field">
                    <label className="field-label">Currency</label>
                    <select
                      id="st-currency"
                      className="select-native"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      disabled={submitting}
                    >
                      <option value="usd">USD — US Dollar</option>
                      <option value="eur">EUR — Euro</option>
                      <option value="gbp">GBP — British Pound</option>
                      <option value="sgd">SGD — Singapore Dollar</option>
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label">Notes (optional)</label>
                    <input
                      id="st-notes"
                      type="text"
                      className="field-input"
                      placeholder="e.g. Payout for order #123"
                      maxLength={50}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      disabled={submitting}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting || !companyId}
                  style={{ gap: 7 }}
                >
                  <Icon d={IconPaths.transfer} size={13} />
                  {submitting ? 'Sending…' : 'Create transfer'}
                </button>
                {msg && (
                  <div
                    className={`alert ${msg.error ? 'alert-error' : 'alert-success'}`}
                    style={{ marginTop: 12 }}
                  >
                    {msg.text}
                  </div>
                )}
              </form>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.transfer} size={14} />
              <span className="card-title">Bulk transfer (batch)</span>
            </div>
          </div>
          <div className="card-body">
            <p className="card-desc">
              Split a total amount into multiple transfers of a fixed size. For example, total{' '}
              <strong>$20</strong> with <strong>$5</strong> per transfer sends 4 separate transfers. Fees are
              reserved up front — the last transfer is automatically reduced to the maximum amount that fits your
              balance so the batch does not fail on the final chunk.
            </p>
            {!companyId ? (
              <div className="alert alert-error" style={{ marginTop: 12 }}>
                Set your Whop API key and Company ID in Settings first.
              </div>
            ) : (
              <form onSubmit={handleBulkSubmit} style={{ marginTop: 16 }}>
                <div className="field">
                  <label className="field-label">Destination ID *</label>
                  <input
                    type="text"
                    className="field-input monospace"
                    placeholder="user_xxx, biz_xxx, or ldgr_xxx"
                    value={bulkDestinationId}
                    onChange={(e) => setBulkDestinationId(e.target.value)}
                    autoComplete="off"
                    disabled={bulkSubmitting}
                  />
                </div>
                <div className="form-grid-3">
                  <div className="field">
                    <label className="field-label">Total amount *</label>
                    <div className="amount-input-wrap">
                      <input
                        type="number"
                        className="field-input"
                        placeholder="20.00"
                        min="0.01"
                        step="0.01"
                        value={bulkTotalAmount}
                        onChange={(e) => setBulkTotalAmount(e.target.value)}
                        disabled={bulkSubmitting}
                      />
                      <BalanceFillButton
                        currency={bulkCurrency}
                        disabled={bulkSubmitting}
                        onFill={setBulkTotalAmount}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label className="field-label">Per transfer amount *</label>
                    <input
                      type="number"
                      className="field-input"
                      placeholder="5.00"
                      min="0.01"
                      step="0.01"
                      value={bulkPerAmount}
                      onChange={(e) => setBulkPerAmount(e.target.value)}
                      disabled={bulkSubmitting}
                    />
                  </div>
                  <div className="field">
                    <label className="field-label">Currency</label>
                    <select
                      className="select-native"
                      value={bulkCurrency}
                      onChange={(e) => setBulkCurrency(e.target.value)}
                      disabled={bulkSubmitting}
                    >
                      <option value="usd">USD — US Dollar</option>
                      <option value="eur">EUR — Euro</option>
                      <option value="gbp">GBP — British Pound</option>
                      <option value="sgd">SGD — Singapore Dollar</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">Notes (optional)</label>
                  <input
                    type="text"
                    className="field-input"
                    placeholder="e.g. Weekly payout batch"
                    maxLength={40}
                    value={bulkNotes}
                    onChange={(e) => setBulkNotes(e.target.value)}
                    disabled={bulkSubmitting}
                  />
                </div>

                {bulkPreview && (
                  <div
                    className="alert"
                    style={{
                      marginBottom: 14,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>
                      Plan: {bulkPreview.count} transfer{bulkPreview.count !== 1 ? 's' : ''}
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6 }}>
                      {bulkPreview.grossChunks.map((gross, i) => {
                        const t = bulkPreview.transfers[i];
                        const isLast = i === bulkPreview.grossChunks.length - 1;
                        const feeAdjusted =
                          isLast &&
                          (bulkPreview.lastChunkFeeAdjusted || gross < bulkPreview.perAmount - 1e-9);
                        return (
                          <div key={i}>
                            Transfer {i + 1}: {formatCurrency(gross, bulkCurrency)} gross → ~
                            {formatCurrency(t.adjusted, bulkCurrency)} received
                            {feeAdjusted ? ' (fee-adjusted remainder)' : ''}
                          </div>
                        );
                      })}
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                        Total gross: {formatCurrency(bulkPreview.totalGross, bulkCurrency)} · Estimated debit:{' '}
                        ~{formatCurrency(bulkPreview.totalEstimatedDebit, bulkCurrency)} · Estimated received:{' '}
                        ~{formatCurrency(bulkPreview.totalAdjusted, bulkCurrency)}
                        {bulkPreview.belowMinimum && (
                          <span style={{ color: 'var(--danger)', display: 'block', marginTop: 4 }}>
                            One or more transfers fall below the ${MIN_TRANSFER_USD.toFixed(2)} minimum after fees.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={bulkSubmitting || !companyId || !bulkPreview || Boolean(bulkPreview?.belowMinimum)}
                  style={{ gap: 7 }}
                >
                  <Icon d={IconPaths.transfer} size={13} />
                  {bulkSubmitting
                    ? bulkProgress
                      ? `Sending ${bulkProgress.current}/${bulkProgress.total}…`
                      : 'Starting batch…'
                    : `Start batch (${bulkPreview?.count ?? 0} transfers)`}
                </button>
                {bulkProgress && (
                  <div className="alert" style={{ marginTop: 12 }}>
                    Sending transfer {bulkProgress.current} of {bulkProgress.total}…
                  </div>
                )}
                {bulkMsg && (
                  <div
                    className={`alert ${bulkMsg.error ? 'alert-error' : 'alert-success'}`}
                    style={{ marginTop: 12 }}
                  >
                    {bulkMsg.text}
                  </div>
                )}
              </form>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.transfer} size={14} />
              <span className="card-title">Recent transfers</span>
              <span
                style={{
                  background: 'var(--surface-3)',
                  border: '1px solid var(--border)',
                  borderRadius: 99,
                  padding: '3px 10px',
                  fontSize: 14,
                  color: 'var(--text-2)',
                }}
              >
                {transfers.length}
              </span>
            </div>
          </div>
          <div className="card-body">
            {loadingTransfers ? (
              <div className="empty-state">
                <p>Loading…</p>
              </div>
            ) : transfers.length === 0 ? (
              <div className="empty-state">
                <p>No transfers yet</p>
                <p>Create a transfer above to see it here.</p>
              </div>
            ) : (
              <>
                <div
                  className="account-row account-row-header"
                  style={{
                    padding: '8px 20px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    marginBottom: 0,
                  }}
                >
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Date
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Amount
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Fee
                  </div>
                  <div style={{ flex: 2, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Destination
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    ID
                  </div>
                </div>
                {transfers.map((t) => (
                  <div key={t.id} className="account-row">
                    <div style={{ flex: 1 }}>{formatDate(t.created_at)}</div>
                    <div style={{ flex: 1, fontWeight: 500 }}>{formatCurrency(t.amount, t.currency || 'usd')}</div>
                    <div style={{ flex: 1, color: 'var(--text-2)' }}>
                      {t.fee_amount != null && t.fee_amount > 0 ? formatCurrency(t.fee_amount, t.currency || 'usd') : '—'}
                    </div>
                    <div style={{ flex: 2 }} className="account-id monospace" title={t.destination_ledger_account_id}>
                      {(t.destination_ledger_account_id || '').slice(0, 24)}
                      {(t.destination_ledger_account_id?.length ?? 0) > 24 ? '…' : ''}
                    </div>
                    <div style={{ flex: 1 }} className="account-id monospace" title={t.id}>
                      {t.id.slice(0, 12)}…
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
