import { useState, useEffect } from 'react';
import { Icon, IconPaths } from '../components/Icon';
import { getProducts, type Product } from '../api';
import { useToast } from '../context/ToastContext';
import { logError } from '../utils/logger';

function formatDate(iso: string | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const load = () => {
    setLoading(true);
    setError(null);
    getProducts()
      .then((res) => {
        setProducts(res.data || []);
      })
      .catch((err) => {
        setProducts([]);
        const msg = err instanceof Error ? err.message : 'Failed to load products';
        setError(msg);
        logError('Load products', msg);
        showToast(msg, 'error');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="main">
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="topbar-title">Products</span>
          <span className="topbar-sub">· Whop API</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading} style={{ gap: 6 }}>
          <Icon d={IconPaths.refresh} size={12} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <div className="content">
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.package} size={14} />
              <span className="card-title">Products</span>
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
                {products.length}
              </span>
            </div>
          </div>
          <div className="card-body">
            <p className="card-desc">
              Products for your company from the Whop API. Create and manage products in your Whop dashboard.
            </p>
            {error && (
              <div className="alert alert-error" style={{ marginBottom: 16 }}>
                {error}
              </div>
            )}
            {loading ? (
              <div className="empty-state">
                <p>Loading…</p>
              </div>
            ) : products.length === 0 && !error ? (
              <div className="empty-state">
                <p>No products</p>
                <p>Create products in your Whop company to see them here. Ensure WHOP_API_KEY and WHOP_PARENT_COMPANY_ID are set.</p>
              </div>
            ) : products.length === 0 ? null : (
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
                  <div style={{ flex: 2, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Product
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Members
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Created
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Visibility
                  </div>
                </div>
                {products.map((p) => (
                  <div key={p.id} className="account-row">
                    <div style={{ flex: 2 }}>
                      <div className="account-name">{p.title || 'Untitled'}</div>
                      {p.headline && (
                        <div className="account-username" style={{ marginTop: 2 }}>
                          {p.headline}
                        </div>
                      )}
                      <div className="account-id monospace" style={{ marginTop: 2 }}>
                        {p.id}
                      </div>
                    </div>
                    <div style={{ flex: 1 }} className="account-username">
                      {p.member_count != null ? p.member_count : '—'}
                    </div>
                    <div style={{ flex: 1 }} className="account-username">
                      {formatDate(p.created_at)}
                    </div>
                    <div style={{ flex: 1 }}>
                      {p.visibility ? (
                        <span className="badge badge-active" style={{ background: 'var(--surface-3)', color: 'var(--text-2)', borderColor: 'var(--border)' }}>
                          {String(p.visibility)}
                        </span>
                      ) : (
                        '—'
                      )}
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
