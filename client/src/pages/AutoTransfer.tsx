import { useState, useEffect } from 'react';
import { Icon, IconPaths } from '../components/Icon';
import {
  getAutoTransfer,
  getSplitRules,
  updateAutoTransferEnabled,
  createAutoTransferRule,
  deleteAutoTransferRule,
  processPaymentsAutoTransfer,
  getProducts,
  getPayments,
  getSettings,
  type AutoTransferRule,
  type Product,
} from '../api';
import { useToast } from '../context/ToastContext';
import { logSuccess, logError } from '../utils/logger';

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
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

export default function AutoTransfer() {
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<AutoTransferRule[]>([]);
  const [processedIds, setProcessedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [payments, setPayments] = useState<Array<{ id: string; status: string; amount_after_fees: number; total: number | null; currency: string; paid_at: string | null; created_at: string; product: { id: string; title?: string } | null; plan: { id: string } | null }>>([]);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [addProductId, setAddProductId] = useState('');
  const [addPlanId, setAddPlanId] = useState('');
  const [addDestinationId, setAddDestinationId] = useState('');
  const [addType, setAddType] = useState<'percentage' | 'fixed'>('percentage');
  const [addValue, setAddValue] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [productIdsInAutoSplit, setProductIdsInAutoSplit] = useState<Set<string>>(new Set());
  const { showToast } = useToast();

  const load = () => {
    setLoading(true);
    setMsg(null);
    Promise.all([
      getAutoTransfer().catch((err) => {
        logError('Auto-transfer load', err instanceof Error ? err.message : 'Failed to load');
        return { enabled: false, rules: [], processedPaymentIds: [] };
      }),
      getSplitRules().catch(() => ({ enabled: false, rules: [] })),
      getProducts(),
      getPayments(),
      getSettings(),
    ])
      .then(([atRes, splitRes, productsRes, paymentsRes, settings]) => {
        setEnabled(atRes.enabled);
        setRules(atRes.rules || []);
        setProcessedIds(atRes.processedPaymentIds || []);
        setProducts(productsRes.data || []);
        setPayments(paymentsRes.data || []);
        setWebhookUrl(settings?.webhookUrl ?? null);
        setProductIdsInAutoSplit(new Set((splitRes.rules || []).map((r) => r.productId ?? '__any__')));
      })
      .catch((err) => {
        const text = err instanceof Error ? err.message : 'Failed to load';
        setMsg({ text, error: true });
        logError('Auto-transfer load', text);
        showToast(text, 'error');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggleEnabled = () => {
    setProcessing(true);
    updateAutoTransferEnabled(!enabled)
      .then((res) => {
        setEnabled(res.enabled);
        const text = res.enabled ? 'Auto-transfer enabled.' : 'Auto-transfer disabled.';
        setMsg({ text, error: false });
        logSuccess('Auto-transfer toggle', text, { enabled: res.enabled });
        showToast(text);
      })
      .catch((err) => {
        const text = err instanceof Error ? err.message : 'Failed to update';
        setMsg({ text, error: true });
        logError('Auto-transfer toggle', text);
        showToast(text, 'error');
      })
      .finally(() => setProcessing(false));
  };

  const handleProcessPayments = () => {
    setProcessing(true);
    setMsg(null);
    processPaymentsAutoTransfer()
      .then((res) => {
        const text = `Queued ${res.queued} payment(s), skipped ${res.skipped}.${res.errors?.length ? ` ${res.errors.length} error(s).` : ''} Processing in background.`;
        setMsg({ text, error: res.errors?.length > 0 });
        if (res.errors?.length) logError('Process payments (auto-transfer)', text, { errors: res.errors });
        else logSuccess('Process payments (auto-transfer)', text, { queued: res.queued, skipped: res.skipped });
        showToast(text, res.errors?.length ? 'error' : 'success');
        load();
      })
      .catch((err) => {
        const text = err instanceof Error ? err.message : 'Failed to process payments';
        setMsg({ text, error: true });
        logError('Process payments (auto-transfer)', text);
        showToast(text, 'error');
      })
      .finally(() => setProcessing(false));
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const destId = addDestinationId.trim();
    const numVal = parseFloat(addValue);
    const productKey = addProductId.trim() || '__any__';
    if (productIdsInAutoSplit.has(productKey)) {
      setMsg({
        text: 'This product is linked to Auto-split. A product can only be in Auto-split or Auto-transfer, not both.',
        error: true,
      });
      showToast('Product is linked to Auto-split', 'error');
      return;
    }
    if (!destId) {
      setMsg({ text: 'Destination ID is required (user_xxx, biz_xxx, or ldgr_xxx).', error: true });
      showToast('Destination ID is required', 'error');
      return;
    }
    if (!Number.isFinite(numVal) || numVal <= 0) {
      setMsg({ text: 'Enter a valid positive value.', error: true });
      showToast('Enter a valid positive value', 'error');
      return;
    }
    if (addType === 'percentage' && numVal > 100) {
      setMsg({ text: 'Percentage cannot exceed 100.', error: true });
      showToast('Percentage cannot exceed 100', 'error');
      return;
    }
    setAddLoading(true);
    try {
      await createAutoTransferRule({
        productId: addProductId.trim() || null,
        planId: addPlanId.trim() || null,
        destination_id: destId,
        transfer_type: addType,
        value: numVal,
      });
      setMsg({ text: 'Rule added.', error: false });
      logSuccess('Add auto-transfer rule', 'Rule added.', { destination_id: destId });
      showToast('Rule added.');
      setAddProductId('');
      setAddPlanId('');
      setAddDestinationId('');
      setAddValue('');
      load();
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Failed to add rule';
      setMsg({ text, error: true });
      logError('Add auto-transfer rule', text);
      showToast(text, 'error');
    } finally {
      setAddLoading(false);
    }
  };

  const handleDeleteRule = (id: string) => {
    deleteAutoTransferRule(id)
      .then((res) => {
        setRules(res.rules || []);
        showToast('Rule deleted');
        logSuccess('Delete auto-transfer rule', 'Rule deleted', { rule_id: id });
      })
      .catch((err) => {
        showToast(err instanceof Error ? err.message : 'Failed to delete', 'error');
      });
  };

  const productTitle = (id: string) => products.find((p) => p.id === id)?.title || id;

  return (
    <main className="main">
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="topbar-title">Auto transfer</span>
          <span className="topbar-sub">· Send % or fixed amount to any account on payment</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading} style={{ gap: 6 }}>
          <Icon d={IconPaths.refresh} size={12} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <div className="content">
        {msg && (
          <div className={`alert ${msg.error ? 'alert-error' : 'alert-success'}`}>
            {msg.text}
          </div>
        )}

        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.settings} size={14} />
              <span className="card-title">How to integrate</span>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setDocsOpen(!docsOpen)}
              style={{ gap: 6 }}
            >
              <Icon d={IconPaths.settings} size={12} />
              {docsOpen ? 'Hide' : 'Show'}
            </button>
          </div>
          {docsOpen && (
            <div className="card-body" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <div className="docs-section">
                <h3 style={{ fontSize: 15, marginBottom: 12 }}>Auto-transfer integration</h3>
                <p style={{ marginBottom: 12, color: 'var(--text-2)' }}>
                  When a payment succeeds, you can automatically send a <strong>percentage</strong> or <strong>fixed amount</strong> to
                  any Whop account (user, company, or ledger) based on the purchased product. Uses the same webhook as Auto-split.
                </p>
                <h4 style={{ fontSize: 14, marginBottom: 8 }}>1. Webhook URL</h4>
                <p style={{ marginBottom: 8, color: 'var(--text-2)' }}>
                  In Whop: go to your company → Developer / Webhooks (or API settings). Add an endpoint and subscribe
                  to <code style={{ background: 'var(--surface-3)', padding: '2px 6px', borderRadius: 4 }}>payment.succeeded</code>.
                  Use the <strong>unique URL below</strong> (same as Auto-split — one webhook runs both).
                </p>
                <div
                  style={{
                    padding: '12px 14px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontFamily: 'monospace',
                    fontSize: 13,
                    wordBreak: 'break-all',
                    marginBottom: 16,
                  }}
                >
                  {(() => {
                    const url = webhookUrl ?? (typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/whop` : null);
                    const isLocalhost = url?.includes('localhost');
                    const isProd = typeof import.meta !== 'undefined' && import.meta.env?.PROD;
                    if (url && isLocalhost && isProd) {
                      return <span style={{ color: 'var(--text-2)' }}>Set APP_BASE_URL on the server to see your webhook URL</span>;
                    }
                    return url || 'https://your-domain.com/api/webhooks/whop';
                  })()}
                </div>
                {(!webhookUrl || (import.meta.env?.PROD && webhookUrl?.includes('localhost'))) && (
                  <p style={{ marginTop: -8, marginBottom: 16, fontSize: 12, color: 'var(--text-2)' }}>
                    {import.meta.env?.PROD && !webhookUrl
                      ? 'Set APP_BASE_URL on the server to your production URL, then refresh. Complete Whop setup in Settings to get your unique webhook URL (with token).'
                      : 'Complete Whop setup in Settings to get your unique webhook URL (with token) for this account.'}
                  </p>
                )}
                <h4 style={{ fontSize: 14, marginBottom: 8 }}>2. How it works</h4>
                <p style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>
                  On each <code>payment.succeeded</code> (or when you run &quot;Process recent payments&quot;), the server runs
                  auto-transfer rules that match the payment’s product (and optional plan). Each rule sends a <strong>percentage</strong> of
                  the payment’s amount_after_fees, or a <strong>fixed amount</strong>, to the rule’s destination (user_xxx, biz_xxx, or ldgr_xxx).
                  Each payment is only processed once for auto-transfer.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.zap} size={14} />
              <span className="card-title">Workflow</span>
              <span
                style={{
                  background: enabled ? 'var(--success)' : 'var(--surface-3)',
                  color: enabled ? '#fff' : 'var(--text-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 99,
                  padding: '3px 10px',
                  fontSize: 14,
                }}
              >
                {enabled ? 'On' : 'Off'}
              </span>
            </div>
            <button
              className={`btn btn-sm ${enabled ? 'btn-ghost' : 'btn-primary'}`}
              onClick={handleToggleEnabled}
              disabled={processing}
              style={{ gap: 6 }}
            >
              {enabled ? 'Disable' : 'Enable'} auto-transfer
            </button>
          </div>
          <div className="card-body">
            <p className="card-desc">
              When a payment is received, a percentage or fixed amount can be sent automatically to any account (user, company, or ledger).
              Add rules below and enable the workflow. Uses the same webhook as Auto-split; or use &quot;Process recent payments&quot; to catch up.
            </p>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.settings} size={14} />
              <span className="card-title">Transfer rules</span>
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
                {rules.length}
              </span>
            </div>
          </div>
          <div className="card-body">
            {loading ? (
              <div className="empty-state">
                <p>Loading…</p>
              </div>
            ) : rules.length === 0 ? (
              <div className="empty-state">
                <p>No transfer rules yet</p>
                <p>Add a rule below: optional product/plan filter, destination (user_xxx, biz_xxx, ldgr_xxx), and percentage or fixed amount.</p>
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
                  <div style={{ flex: 2 }}>Product / Plan</div>
                  <div style={{ flex: 2 }}>Destination</div>
                  <div style={{ flex: 1 }}>Type / Value</div>
                  <div style={{ flex: 1 }}>Actions</div>
                </div>
                {rules.map((r) => (
                  <div key={r.id} className="account-row">
                    <div style={{ flex: 2 }}>
                      <div className="account-name">{r.productId ? productTitle(r.productId) : 'Any product'}</div>
                      {r.planId && <div className="account-username">Plan: {r.planId}</div>}
                    </div>
                    <div style={{ flex: 2 }} className="account-id monospace">
                      {r.destination_id}
                    </div>
                    <div style={{ flex: 1 }}>
                      <span className="badge badge-active" style={{ background: 'var(--surface-3)', color: 'var(--text-2)', borderColor: 'var(--border)' }}>
                        {r.transfer_type === 'fixed' ? `$${r.value}` : `${r.value}%`}
                      </span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--red)' }}
                        onClick={() => handleDeleteRule(r.id)}
                      >
                        <Icon d={IconPaths.trash} size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.plus} size={14} />
              <span className="card-title">Add rule</span>
            </div>
          </div>
          <div className="card-body">
            <p className="card-desc">
              When a payment matches the product (optional) and plan (optional), send a percentage or fixed amount to the destination. Destination can be any user_xxx, biz_xxx, or ldgr_xxx.
            </p>
            <form onSubmit={handleAddRule}>
              <div className="form-grid-2">
                <div className="field">
                  <label className="field-label">Product</label>
                  <select
                    className="select-native"
                    value={addProductId}
                    onChange={(e) => setAddProductId(e.target.value)}
                    disabled={addLoading}
                  >
                    <option value="" disabled={productIdsInAutoSplit.has('__any__')}>
                      {productIdsInAutoSplit.has('__any__') ? 'Any product (used in Auto-split)' : 'Any product'}
                    </option>
                    {products.map((p) => {
                      const inSplit = productIdsInAutoSplit.has(p.id);
                      return (
                        <option key={p.id} value={p.id} disabled={inSplit}>
                          {p.title || p.id}
                          {inSplit ? ' (linked to Auto-split)' : ''}
                        </option>
                      );
                    })}
                  </select>
                  {productIdsInAutoSplit.size > 0 && (
                    <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6 }}>
                      Products linked to Auto-split cannot be used in Auto-transfer (one per product).
                    </p>
                  )}
                </div>
                <div className="field">
                  <label className="field-label">Plan ID (optional)</label>
                  <input
                    className="field-input monospace"
                    placeholder="plan_xxx"
                    value={addPlanId}
                    onChange={(e) => setAddPlanId(e.target.value)}
                    disabled={addLoading}
                  />
                </div>
              </div>
              <div className="field">
                <label className="field-label">Destination ID *</label>
                <input
                  className="field-input monospace"
                  placeholder="user_xxx, biz_xxx, or ldgr_xxx"
                  value={addDestinationId}
                  onChange={(e) => setAddDestinationId(e.target.value)}
                  disabled={addLoading}
                />
              </div>
              <div className="form-grid-2">
                <div className="field">
                  <label className="field-label">Transfer type</label>
                  <select
                    className="select-native"
                    value={addType}
                    onChange={(e) => setAddType(e.target.value as 'percentage' | 'fixed')}
                    disabled={addLoading}
                  >
                    <option value="percentage">Percentage of payment</option>
                    <option value="fixed">Fixed amount</option>
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">{addType === 'percentage' ? 'Percentage (%)' : 'Amount (USD)'}</label>
                  <input
                    className="field-input"
                    type="number"
                    step={addType === 'percentage' ? '0.01' : '0.01'}
                    min="0"
                    max={addType === 'percentage' ? '100' : undefined}
                    placeholder={addType === 'percentage' ? '10' : '5.00'}
                    value={addValue}
                    onChange={(e) => setAddValue(e.target.value)}
                    disabled={addLoading}
                  />
                </div>
              </div>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={addLoading}
                style={{ marginTop: 16, gap: 7 }}
              >
                <Icon d={IconPaths.plus} size={13} />
                {addLoading ? 'Adding…' : 'Add rule'}
              </button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.receipt} size={14} />
              <span className="card-title">Recent payments</span>
            </div>
            <button
              className="btn btn-orange-ghost btn-sm"
              onClick={handleProcessPayments}
              disabled={processing || !enabled}
              style={{ gap: 6 }}
            >
              <Icon d={IconPaths.zap} size={11} />
              Process recent payments
            </button>
          </div>
          <div className="card-body">
            <p className="card-desc">
              Paid payments that have not been processed yet for auto-transfer will get transfers applied when you run &quot;Process recent payments&quot; (or when the webhook runs). Green check = already processed.
            </p>
            {payments.length === 0 ? (
              <div className="empty-state">
                <p>No payments loaded</p>
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
                  <div style={{ flex: 1 }}>Date</div>
                  <div style={{ flex: 1 }}>Amount</div>
                  <div style={{ flex: 2 }}>Product</div>
                  <div style={{ flex: 1 }}>Status</div>
                </div>
                {payments.slice(0, 20).map((p) => {
                  const isProcessed = processedIds.includes(p.id);
                  return (
                    <div key={p.id} className="account-row">
                      <div style={{ flex: 1 }}>{formatDate(p.paid_at || p.created_at)}</div>
                      <div style={{ flex: 1, fontWeight: 500 }}>
                        {formatCurrency(p.amount_after_fees ?? p.total ?? 0, p.currency)}
                      </div>
                      <div style={{ flex: 2 }} className="account-username">
                        {p.product?.title || p.product?.id || '—'}
                      </div>
                      <div style={{ flex: 1 }}>
                        {isProcessed ? (
                          <span className="badge badge-active" style={{ background: 'var(--success)', color: '#fff' }}>
                            Processed
                          </span>
                        ) : (
                          <span className="badge badge-active" style={{ background: 'var(--surface-3)', color: 'var(--text-2)' }}>
                            {p.status}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
