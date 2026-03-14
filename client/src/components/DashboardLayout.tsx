import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon, IconPaths } from './Icon';
import { getSettings } from '../api';

type Props = { user: { id: number; email: string; role?: 'user' | 'admin' }; onLogout: () => void };

export default function DashboardLayout({ user, onLogout }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [whopConfigured, setWhopConfigured] = useState(false);

  const loadSettings = () => {
    getSettings()
      .then((s) => {
        setSettingsLoaded(true);
        setWhopConfigured(Boolean(s.whopApiKeySet && s.whopCompanyIdSet));
      })
      .catch(() => {
        setSettingsLoaded(true);
        setWhopConfigured(false);
      });
  };

  useEffect(() => {
    loadSettings();
  }, [location.pathname]);

  useEffect(() => {
    const onSaved = () => loadSettings();
    window.addEventListener('whop-settings-saved', onSaved);
    return () => window.removeEventListener('whop-settings-saved', onSaved);
  }, []);

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `nav-item${isActive ? ' active' : ''}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {settingsLoaded && !whopConfigured && user.role !== 'admin' && (
        <div
          className="setup-required-banner"
          style={{
            flexShrink: 0,
            background: 'var(--accent-dim)',
            borderBottom: '1px solid var(--accent-border)',
            padding: '12px 24px',
            display: 'none',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ color: 'var(--text)', fontSize: 14, fontWeight: 500 }}>
            Please set your Whop API key and Company ID in Settings before using the app.
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => navigate('/settings')}
          >
            Go to Settings
          </button>
        </div>
      )}
      <div className="dashboard" style={{ flex: 1, minHeight: 0 }}>
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src="/whop-icon.svg" alt="Whop" className="logo-mark logo-img" style={{ width: 40, height: 40 }} />
          <div>
            <div className="sidebar-logo-text">Whop Connect</div>
            <div className="sidebar-logo-sub">Dashboard</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {user.role === 'admin' ? (
            <>
              <NavLink to="/analytics" className={navClass}>
                <span className="nav-icon">
                  <Icon d={IconPaths.chart} size={14} />
                </span>
                Analytics
              </NavLink>
              <NavLink to="/admin" className={navClass}>
                <span className="nav-icon">
                  <Icon d={IconPaths.users} size={14} />
                </span>
                Users
              </NavLink>
              <NavLink to="/logs" className={navClass}>
                <span className="nav-icon">
                  <Icon d={IconPaths.terminal} size={14} />
                </span>
                Logs
              </NavLink>
            </>
          ) : (
            <>
              <NavLink to="/connected-accounts" className={navClass}>
                <span className="nav-icon">
                  <Icon d={IconPaths.link} size={14} />
                </span>
                Connected accounts
              </NavLink>
              <NavLink to="/transactions" className={navClass}>
                <span className="nav-icon">
                  <Icon d={IconPaths.transfer} size={14} />
                </span>
                Transactions
              </NavLink>
              <NavLink to="/auto-split" className={navClass}>
                <span className="nav-icon">
                  <Icon d={IconPaths.zap} size={14} />
                </span>
                Auto-split
              </NavLink>
              <NavLink to="/products" className={navClass}>
                <span className="nav-icon">
                  <Icon d={IconPaths.package} size={14} />
                </span>
                Products
              </NavLink>
              <NavLink to="/members" className={navClass}>
                <span className="nav-icon">
                  <Icon d={IconPaths.users} size={14} />
                </span>
                Members
              </NavLink>
              <NavLink to="/settings" className={navClass}>
                <span className="nav-icon">
                  <Icon d={IconPaths.settings} size={14} />
                </span>
                Settings
              </NavLink>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 8 }}>
            Signed in as {user.email}
          </div>
          <button
            className="btn btn-logout btn-sm"
            style={{ width: '100%', gap: 8 }}
            onClick={onLogout}
          >
            <Icon d={IconPaths.logout} size={13} />
            Log out
          </button>
        </div>
      </aside>

      <Outlet context={{ user }} />
      </div>
    </div>
  );
}
