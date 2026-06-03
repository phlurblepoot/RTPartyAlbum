import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { RequireAdmin } from './RequireAdmin';
import { LoginPage } from './LoginPage';
import { AdminLayout } from './AdminLayout';
import { EventsPage } from './EventsPage';
import { EventDetailPage } from './event/EventDetailPage';
import { ThemesPage } from './ThemesPage';
import { SettingsPage } from './SettingsPage';

export function AdminRoutes() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route
          element={
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          }
        >
          <Route index element={<Navigate to="events" replace />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="events/:eventId" element={<EventDetailPage />} />
          <Route path="themes" element={<ThemesPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="events" replace />} />
      </Routes>
    </AuthProvider>
  );
}
