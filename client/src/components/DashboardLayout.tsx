import { Outlet, NavLink } from 'react-router-dom';
import { Icon, IconPaths } from './Icon';

type Props = { user: { id: number; email: string; role?: 'user' | 'admin' }; onLogout: () => void };

export default function DashboardLayout({ user, onLogout }: Props) {
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `nav-item${isActive ? ' active' : ''}`;

  return (
    <div className="dashboard" style={{ height: '100vh', overflow: 'hidden' }}>
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
              <NavLink to="/system-health" className={navClass}>
                <span className="nav-icon">
                  <Icon d={IconPaths.shield} size={14} />
                </span>
                System health
              </NavLink>
              <NavLink to="/logs" className={navClass}>
                <span className="nav-icon">
                  <Icon d={IconPaths.terminal} size={14} />
                </span>
                Logs
              </NavLink>
              <NavLink to="/settings" className={navClass}>
                <span className="nav-icon">
                  <Icon d={IconPaths.settings} size={14} />
                </span>
                Settings
              </NavLink>
            </>
          ) : (
            <>
              <NavLink to="/analytics" className={navClass}>
                <span className="nav-icon">
                  <Icon d={IconPaths.chart} size={14} />
                </span>
                Analytics
              </NavLink>
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
              <NavLink to="/transfer-funds" className={navClass}>
                <span className="nav-icon">
                  <Icon d={IconPaths.send} size={14} />
                </span>
                Transfer funds
              </NavLink>
              <NavLink to="/auto-split" className={navClass}>
                <span className="nav-icon">
                  <Icon d={IconPaths.zap} size={14} />
                </span>
                Auto-split
              </NavLink>
              <NavLink to="/auto-transfer" className={navClass}>
                <span className="nav-icon">
                  <Icon d={IconPaths.send} size={14} />
                </span>
                Auto transfer
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
  );
}
