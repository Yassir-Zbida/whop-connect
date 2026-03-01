import { Outlet, NavLink } from 'react-router-dom';
import { Icon, IconPaths } from './Icon';

type Props = { user: { username: string }; onLogout: () => void };

export default function DashboardLayout({ user, onLogout }: Props) {
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `nav-item${isActive ? ' active' : ''}`;

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src="/whop-icon.svg" alt="Whop" className="logo-mark logo-img" style={{ width: 40, height: 40 }} />
          <div>
            <div className="sidebar-logo-text">Whop Connect</div>
            <div className="sidebar-logo-sub">Dashboard</div>
          </div>
        </div>

        <nav className="sidebar-nav">
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
        </nav>

        <div className="sidebar-footer">
          <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 8 }}>
            Signed in as {user.username}
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

      <Outlet />
    </div>
  );
}
