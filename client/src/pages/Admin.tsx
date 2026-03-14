import { useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Icon, IconPaths } from '../components/Icon';
import { getMe, getAdminUsers, updateAdminUser } from '../api';
import type { AdminUser } from '../api';
import { useToast } from '../context/ToastContext';

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  } catch {
    return iso;
  }
}

type LayoutContext = { user: { id: number; email: string; role?: string } };

export default function Admin() {
  const navigate = useNavigate();
  const { user: currentUser } = useOutletContext<LayoutContext>();
  const { showToast } = useToast();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  useEffect(() => {
    getMe()
      .then((data) => {
        if (data?.user?.role !== 'admin') {
          setAllowed(false);
          navigate('/', { replace: true });
        } else {
          setAllowed(true);
        }
      })
      .catch(() => {
        setAllowed(false);
        navigate('/login', { replace: true });
      });
  }, [navigate]);

  useEffect(() => {
    if (!allowed) return;
    setLoading(true);
    getAdminUsers()
      .then((res) => setUsers(res.data || []))
      .catch(() => showToast('Failed to load users', 'error'))
      .finally(() => setLoading(false));
  }, [allowed, showToast]);

  const handleToggleActive = async (user: AdminUser) => {
    const isActive = user.active !== false;
    setUpdatingId(user.id);
    try {
      const data = await updateAdminUser(user.id, { active: !isActive });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, active: data.user.active } : u)));
      showToast(isActive ? 'User deactivated' : 'User activated');
    } catch (e) {
      showToast((e as Error)?.message || 'Failed to update', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  if (allowed === null) {
    return (
      <main className="main">
        <div className="topbar">
          <span className="topbar-title">Users</span>
        </div>
        <div className="content">
          <div className="card">
            <div className="card-body">
              <p style={{ color: 'var(--text-2)' }}>Checking access…</p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!allowed) return null;

  const activeCount = users.filter((u) => u.active !== false).length;

  return (
    <main className="main">
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="topbar-title">Users</span>
          <span className="topbar-sub">· Manage status</span>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setLoading(true);
            getAdminUsers()
              .then((res) => setUsers(res.data || []))
              .finally(() => setLoading(false));
          }}
          disabled={loading}
          style={{ gap: 6 }}
        >
          <Icon d={IconPaths.refresh} size={12} />
          Refresh
        </button>
      </div>

      <div className="content" style={{ padding: 24 }}>
        {/* Stats row — matches Analytics style */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div className="card" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>{users.length}</div>
            <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4 }}>Total users</div>
          </div>
          <div className="card" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--green)' }}>{activeCount}</div>
            <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4 }}>Active</div>
          </div>
          <div className="card" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-2)' }}>{users.length - activeCount}</div>
            <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4 }}>Deactivated</div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={IconPaths.users} size={14} />
              <span className="card-title">All users</span>
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
                {users.length}
              </span>
            </div>
          </div>

          <div
            className="account-row account-row-header"
            style={{
              padding: '12px 20px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface-2)',
              marginBottom: 0,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-2)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            <div style={{ flex: '0 0 56px' }}>ID</div>
            <div style={{ flex: 2 }}>Email</div>
            <div style={{ flex: '0 0 100px' }}>Role</div>
            <div style={{ flex: '0 0 110px' }}>Status</div>
            <div style={{ flex: '0 0 140px' }}>Created</div>
            <div style={{ flex: 1, minWidth: 180, display: 'flex', justifyContent: 'flex-end' }}>Actions</div>
          </div>

          {loading ? (
            <div className="empty-state">
              <p>Loading users…</p>
            </div>
          ) : users.length === 0 ? (
            <div className="empty-state">
              <p>No users yet</p>
              <p>Users will appear here once they sign up</p>
            </div>
          ) : (
            users.map((u) => {
              const isActive = u.active !== false;
              const isCurrentUser = currentUser?.id === u.id;
              return (
                <div
                  key={u.id}
                  className="account-row"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '14px 20px',
                    gap: 12,
                    borderBottom: '1px solid var(--border)',
                    ...(isCurrentUser
                      ? { background: 'var(--accent-dim)', boxShadow: 'inset 0 0 0 1px var(--accent-border)' }
                      : {}),
                  }}
                >
                  <div style={{ flex: '0 0 56px', fontSize: 14, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                    {u.id}
                  </div>
                  <div style={{ flex: 2, fontSize: 14, wordBreak: 'break-all', fontWeight: isCurrentUser ? 500 : 400 }}>
                    {u.email}
                    {isCurrentUser && (
                      <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>(you)</span>
                    )}
                  </div>
                  <div style={{ flex: '0 0 100px' }}>
                    <span
                      className="badge"
                      style={{
                        padding: '5px 10px',
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        ...(u.role === 'admin'
                          ? { background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }
                          : { background: 'var(--surface-3)', color: 'var(--text-2)', border: '1px solid var(--border)' }),
                      }}
                    >
                      {u.role}
                    </span>
                  </div>
                  <div style={{ flex: '0 0 110px' }}>
                    {isActive ? (
                      <span className="badge badge-active">
                        <span className="badge-dot" />
                        Active
                      </span>
                    ) : (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '5px 11px',
                          borderRadius: 99,
                          fontSize: 13,
                          fontWeight: 500,
                          background: 'var(--red-dim)',
                          color: 'var(--red)',
                          border: '1px solid rgba(239,68,68,0.2)',
                        }}
                      >
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
                        Deactivated
                      </span>
                    )}
                  </div>
                  <div style={{ flex: '0 0 140px', fontSize: 13, color: 'var(--text-2)' }}>{formatDate(u.created_at)}</div>
                  <div style={{ flex: 1, minWidth: 180, display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={isActive ? 'btn btn-danger-ghost btn-sm' : 'btn btn-primary btn-sm'}
                      disabled={updatingId === u.id || isCurrentUser}
                      onClick={() => handleToggleActive(u)}
                      style={{ gap: 6 }}
                      title={isCurrentUser ? 'You cannot deactivate your own account' : undefined}
                    >
                      {updatingId === u.id ? (
                        'Updating…'
                      ) : isActive ? (
                        'Deactivate'
                      ) : (
                        'Activate'
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
