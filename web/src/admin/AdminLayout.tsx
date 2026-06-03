import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function AdminLayout() {
  const { logout } = useAuth();
  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <strong>RTPartyAlbum Admin</strong>
        <button type="button" onClick={() => { void logout(); }}>Log out</button>
      </header>
      <nav className="admin-nav">
        <NavLink to="/admin/events">Events</NavLink>
        <NavLink to="/admin/themes">Themes</NavLink>
        <NavLink to="/admin/settings">Settings</NavLink>
      </nav>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
