import { useState, useEffect } from 'react';
import { Icon, IconPaths } from '../components/Icon';
import {
  getSplitRules,
  updateSplitRulesEnabled,
  createSplitRule,
  deleteSplitRule,
  getCompanies,
  getProducts,
  getPayments,
  processPayments,
  type SplitRule,
  type Product,
} from '../api';
import { useToast } from '../context/ToastContext';
import { logSuccess, logError } from '../utils/logger';

type Company = { id: string; title?: string; owner_user?: { username?: string } };

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

export default function AutoSplit() {
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<SplitRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [payments, setPayments] = useState<Array<{ id: string; status: string; amount_after_fees: number; total: number | null; currency: string; paid_at: string | null; created_at: string; product: { id: string; title?: string } | null; plan: { id: string } | null }>>([]);
  const [processedIds, setProcessedIds] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [processing, setProcessing] = useState(false);

  // Add rule form
  const [addProductId, setAddProductId] = useState('');
  const [addPlanId, setAddPlanId] = useState('');
  const [addSplits, setAddSplits] = useState<Array<{ destination_id: string; percentage: string }>>([
    { destination_id: '', percentage: '' },
  ]);
  const [addLoading, setAddLoading] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const { showToast } = useToast();

  const load = () => {
    setLoading(true);
    setMsg(null);
    Promise.all([
      getSplitRules(),
      getProducts(),
      getCompanies(),
      getPayments(),
    ])
      .then(([rulesRes, productsRes, companiesRes, paymentsRes]) => {
        setEnabled(rulesRes.enabled);
        setRules(rulesRes.rules || []);
        setProducts(productsRes.data || []);
        setCompanies(companiesRes.data || []);
        setPayments(paymentsRes.data || []);
        setProcessedIds(paymentsRes.processedPaymentIds || []);
      })
      .catch((err) => {
        const text = err instanceof Error ? err.message : 'Failed to load';
        setMsg({ text, error: true });
        logError('Auto-split load', text);
        showToast(text, 'error');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggleEnabled = () => {
    setProcessing(true);
    updateSplitRulesEnabled(!enabled)
      .then((res) => {
        setEnabled(res.enabled);
        const text = res.enabled ? 'Auto-split enabled.' : 'Auto-split disabled.';
        setMsg({ text, error: false });
        logSuccess('Auto-split toggle', text, { enabled: res.enabled });
        showToast(text);
      })
      .catch((err) => {
        const text = err instanceof Error ? err.message : 'Failed to update';
        setMsg({ text, error: true });
        logError('Auto-split toggle', text);
        showToast(text, 'error');
      })
      .finally(() => setProcessing(false));
  };

  const handleProcessPayments = () => {
    setProcessing(true);
    setMsg(null);
    processPayments()
      .then((res) => {
        const text = `Processed ${res.processed} payment(s), skipped ${res.skipped}.${res.errors?.length ? ` ${res.errors.length} error(s).` : ''}`;
        setMsg({ text, error: res.errors?.length > 0 });
        if (res.errors?.length) logError('Process payments', text, { processed: res.processed, skipped: res.skipped, errors: res.errors });
        else logSuccess('Process payments', text, { processed: res.processed, skipped: res.skipped });
        showToast(text, res.errors?.length ? 'error' : 'success');
        load();
      })
      .catch((err) => {
        const text = err instanceof Error ? err.message : 'Failed to process payments';
        setMsg({ text, error: true });
        logError('Process payments', text);
        showToast(text, 'error');
      })
      .finally(() => setProcessing(false));
  };

  const addSplitRow = () => {
    setAddSplits((prev) => [...prev, { destination_id: '', percentage: '' }]);
  };

  const updateSplitRow = (index: number, field: 'destination_id' | 'percentage', value: string) => {
    setAddSplits((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const removeSplitRow = (index: number) => {
    setAddSplits((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const splits = addSplits
      .map((s) => ({
        destination_id: s.destination_id.trim(),
        percentage: parseFloat(s.percentage) || 0,
      }))
      .filter((s) => s.destination_id && s.percentage > 0);
    if (splits.length === 0) {
      const text = 'Add at least one destination with a percentage.';
      setMsg({ text, error: true });
      logError('Add split rule', text);
      showToast(text, 'error');
      return;
    }
    setAddLoading(true);
    try {
      await createSplitRule({
        productId: addProductId.trim() || null,
        planId: addPlanId.trim() || null,
        splits,
      });
      setMsg({ text: 'Rule added.', error: false });
      logSuccess('Add split rule', 'Rule added.', { productId: addProductId || null, splitsCount: splits.length });
      showToast('Rule added.');
      setAddProductId('');
      setAddPlanId('');
      setAddSplits([{ destination_id: '', percentage: '' }]);
      load();
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Failed to add rule';
      setMsg({ text, error: true });
      logError('Add split rule', text);
      showToast(text, 'error');
    } finally {
      setAddLoading(false);
    }
  };

  const handleDeleteRule = (id: string) => {
    if (!confirm('Delete this split rule?')) return;
    deleteSplitRule(id)
      .then((res) => {
        setRules(res.rules || []);
        setMsg({ text: 'Rule deleted.', error: false });
        logSuccess('Delete split rule', 'Rule deleted.', { ruleId: id });
        showToast('Rule deleted.');
      })
      .catch((err) => {
        const text = err instanceof Error ? err.message : 'Failed to delete';
        setMsg({ text, error: true });
        logError('Delete split rule', text, { ruleId: id });
        showToast(text, 'error');
      });
  };

  const productTitle = (id: string) => products.find((p) => p.id === id)?.title || id;
  const companyTitle = (id: string) => companies.find((c) => c.id === id)?.title || id;

  return (
    <main className="main">
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="topbar-title">Auto-split</span>
          <span className="topbar-sub">· Send % to suppliers by product</span>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={load}
          disabled={loading}
          style={{ gap: 6 }}
        >
          <Icon d={IconPaths.refresh} size={12} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="content">
        {msg && (
          <div className={`alert ${msg.error ? 'alert-error' : 'alert-success'}`} style={{ marginBottom: 16 }}>
            {msg.text}
          </div>
        )}

        <div className="card">
          <div className="card-header">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setDocsOpen((o) => !o)}
              style={{
                marginRight: 8,
                padding: '4px 8px',
                fontSize: 13,
                color: 'var(--text-2)',
                gap: 6,
              }}
              title="How to integrate"
            >
              <Icon d={IconPaths.settings} size={12} />
              How to integrate
              <span style={{ fontSize: 10, opacity: 0.8 }}>{docsOpen ? '▼' : '▶'}</span>
            </button>
          </div>
          {docsOpen && (
            <div className="card-body" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <div className="docs-section">
                <h3 style={{ fontSize: 15, marginBottom: 12 }}>Auto-split integration</h3>
                <p style={{ marginBottom: 12, color: 'var(--text-2)' }}>
                  When a payment succeeds, you can automatically send a percentage to one or more connected accounts
                  (suppliers) based on the purchased product. Two ways to run the split:
                </p>
                <ol style={{ marginLeft: 20, marginBottom: 16, color: 'var(--text-2)', lineHeight: 1.7 }}>
                  <li>
                    <strong>Webhook (real-time):</strong> Register the URL below in your Whop dashboard so every new
                    payment triggers the split immediately.
                  </li>
                  <li>
                    <strong>Process recent payments:</strong> Use the button in the &quot;Recent payments&quot; section
                    below to run splits for paid payments that haven’t been processed yet (e.g. if the webhook wasn’t
                    set up earlier).
                  </li>
                </ol>
                <h4 style={{ fontSize: 14, marginBottom: 8 }}>1. Webhook URL</h4>
                <p style={{ marginBottom: 8, color: 'var(--text-2)' }}>
                  In Whop: go to your company → Developer / Webhooks (or API settings). Add an endpoint and subscribe
                  to <code style={{ background: 'var(--surface-3)', padding: '2px 6px', borderRadius: 4 }}>payment.succeeded</code>.
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
                  {typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/whop` : 'https://your-domain.com/api/webhooks/whop'}
                </div>
                <h4 style={{ fontSize: 14, marginBottom: 8 }}>2. Requirements</h4>
                <ul style={{ marginLeft: 20, marginBottom: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
                  <li>
                    <code>WHOP_API_KEY</code> and <code>WHOP_PARENT_COMPANY_ID</code> set in the server <code>.env</code>.
                  </li>
                  <li>Connected accounts (suppliers) created under Connected accounts; use their company ID as destination.</li>
                  <li>At least one split rule with a product (or &quot;Any product&quot;) and destination(s) with percentage.</li>
                  <li>Workflow toggled <strong>On</strong> above.</li>
                </ul>
                <h4 style={{ fontSize: 14, marginBottom: 8 }}>3. How it works</h4>
                <p style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>
                  On each <code>payment.succeeded</code> event (or when you run &quot;Process recent payments&quot;), the
                  server looks up rules that match the payment’s product (and optional plan). For each matching rule it
                  creates a transfer from your parent company to each destination for the given percentage of the
                  payment’s <strong>amount_after_fees</strong>. Each payment is only processed once; processed IDs are
                  stored so the same payment is never split twice.
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
              {enabled ? 'Disable' : 'Enable'} auto-split
            </button>
          </div>
          <div className="card-body">
            <p className="card-desc">
              When a payment is received, a percentage can be sent automatically to one or more connected accounts
              (suppliers) based on the purchased product. Configure rules below and enable the workflow. Optionally
              register the webhook URL <code style={{ fontSize: 12 }}>/api/webhooks/whop</code> in your Whop dashboard
              for real-time splits, or use &quot;Process recent payments&quot; to catch up.
            </p>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.settings} size={14} />
              <span className="card-title">Split rules</span>
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
                <p>No split rules yet</p>
                <p>Add a rule below: choose a product (or leave empty for any product) and one or more destinations with percentages.</p>
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
                  <div style={{ flex: 2 }}>Splits</div>
                  <div style={{ flex: 1 }}>Actions</div>
                </div>
                {rules.map((r) => (
                  <div key={r.id} className="account-row">
                    <div style={{ flex: 2 }}>
                      <div className="account-name">
                        {r.productId ? productTitle(r.productId) : 'Any product'}
                      </div>
                      {r.planId && (
                        <div className="account-username">Plan: {r.planId}</div>
                      )}
                    </div>
                    <div style={{ flex: 2, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {(r.splits || []).map((s, i) => (
                        <span
                          key={i}
                          className="badge badge-active"
                          style={{ background: 'var(--surface-3)', color: 'var(--text-2)', borderColor: 'var(--border)' }}
                        >
                          {companyTitle(s.destination_id)}: {s.percentage}%
                        </span>
                      ))}
                    </div>
                    <div style={{ flex: 1 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--danger)' }}
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
              Criteria: product (optional — leave empty to match any product) and optional plan ID. Then add one or more destinations with percentage of the payment to send.
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
                    <option value="">Any product</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title || p.id}
                      </option>
                    ))}
                  </select>
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
              <div style={{ marginTop: 16 }}>
                <label className="field-label">Destinations & percentages</label>
                {addSplits.map((s, i) => (
                  <div key={i} className="form-grid-2" style={{ marginTop: 8, alignItems: 'center', gap: 8 }}>
                    <select
                      className="select-native"
                      value={s.destination_id}
                      onChange={(e) => updateSplitRow(i, 'destination_id', e.target.value)}
                      disabled={addLoading}
                    >
                      <option value="">Select account</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title || c.id}
                        </option>
                      ))}
                    </select>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        className="field-input"
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        placeholder="%"
                        value={s.percentage}
                        onChange={(e) => updateSplitRow(i, 'percentage', e.target.value)}
                        disabled={addLoading}
                        style={{ width: 80 }}
                      />
                      <span style={{ color: 'var(--text-2)' }}>%</span>
                      {addSplits.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => removeSplitRow(i)}
                        >
                          <Icon d={IconPaths.trash} size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={addSplitRow}>
                  <Icon d={IconPaths.plus} size={12} /> Add destination
                </button>
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
              Paid payments that have not been processed yet will get splits applied when you run &quot;Process recent payments&quot; (or when the webhook runs). Green check = already processed.
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
